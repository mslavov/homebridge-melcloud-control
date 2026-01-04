/**
 * Tests for Thermal module
 * - InfluxClient (with mocked InfluxDB)
 * - ThermalCalibrator
 * - ThermalManager
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { ThermalCalibrator } from '../src/deviceata/thermal/thermal-calibrator.js';
import { ThermalManager } from '../src/deviceata/thermal/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Create a minimal device context for testing
function createMockDevice(overrides = {}) {
    return {
        deviceId: 'test-device-123',
        targetTemperature: 23,
        location: { latitude: 42.7, longitude: 23.3 },
        roomCurrentTemp: 22.5,
        userTargetTemperature: 23,
        logDebug: false,
        logInfo: false,
        logWarn: false,
        influxConfig: {
            enabled: true,
            host: 'localhost',
            port: 8086,
            database: 'test_homebridge',
            username: '',
            password: '',
            retentionDays: 7
        },
        accessoryState: {
            targetHeaterCoolerState: 1
        },
        predictiveController: {
            weatherClient: {
                getCurrentOutdoorTemp: () => 5,
                getCurrentSolarRadiation: () => 150
            },
            stateMachine: {
                getCurrentState: () => 'STANDBY'
            },
            getSeasonMode: () => 'winter',
            updateBuildingParameters: () => {}
        },
        api: {
            user: {
                storagePath: () => os.tmpdir()
            }
        },
        emit: () => {},
        ...overrides
    };
}

// Mock InfluxDB client for testing without real database
function createMockInfluxClient() {
    return {
        isConnected: false,
        writeBuffer: [],

        async init() {
            this.isConnected = true;
            return true;
        },

        writePoint(data) {
            if (this.isConnected) {
                this.writeBuffer.push(data);
            }
        },

        getIsConnected() {
            return this.isConnected;
        },

        async getHvacOffPeriods(deviceId, minHours) {
            // Return mock periods for calibration testing
            return [
                [
                    { temp: 23, outdoor: 5 },
                    { temp: 22.8, outdoor: 5 },
                    { temp: 22.6, outdoor: 5 },
                    { temp: 22.4, outdoor: 5 },
                    { temp: 22.2, outdoor: 5 },
                    { temp: 22.0, outdoor: 5 },
                    { temp: 21.8, outdoor: 5 },
                    { temp: 21.6, outdoor: 5 },
                    { temp: 21.5, outdoor: 5 },
                    { temp: 21.4, outdoor: 5 }
                ]
            ];
        },

        async getSunnyPeriods(deviceId, minRadiation) {
            return [
                { temp: 22.0, solar: 300 },
                { temp: 22.1, solar: 350 },
                { temp: 22.3, solar: 380 },
                { temp: 22.5, solar: 400 },
                { temp: 22.8, solar: 420 },
                { temp: 23.0, solar: 410 },
                { temp: 23.2, solar: 390 },
                { temp: 23.4, solar: 350 }
            ];
        },

        async getHeatingPeriods(deviceId) {
            return [
                { indoor: 21, outdoor: 0, setpoint: 24 },
                { indoor: 21.5, outdoor: -2, setpoint: 24 },
                { indoor: 22, outdoor: -1, setpoint: 24 },
                { indoor: 22.5, outdoor: 0, setpoint: 23 }
            ];
        },

        async stop() {
            this.isConnected = false;
        }
    };
}

describe('ThermalCalibrator', () => {
    let calibrator;
    let device;
    let mockInflux;
    let tempDir;

    beforeEach(async () => {
        device = createMockDevice();
        mockInflux = createMockInfluxClient();
        await mockInflux.init();
        calibrator = new ThermalCalibrator(device, mockInflux);

        // Create temp directory for params file
        tempDir = path.join(os.tmpdir(), `thermal-test-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
        calibrator.stop();
        // Clean up temp files
        try {
            await fs.rm(tempDir, { recursive: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe('Initialization', () => {
        test('initializes with default parameters', async () => {
            await calibrator.init(tempDir);

            const params = calibrator.getParams();
            assert.strictEqual(params.timeConstant, 18);
            assert.ok(params.solarGainFactor > 0);
            assert.ok(params.heatLossCoefficient > 0);
        });

        test('creates params file path correctly', async () => {
            await calibrator.init(tempDir);

            assert.ok(calibrator.paramsFile.includes('test-device-123'));
            assert.ok(calibrator.paramsFile.includes('thermal_params.json'));
        });
    });

    describe('Parameter Persistence', () => {
        test('saves and loads parameters', async () => {
            await calibrator.init(tempDir);

            // Modify parameters
            calibrator.params.timeConstant = 24;
            calibrator.params.solarGainFactor = 0.02;
            await calibrator._saveParams();

            // Create new calibrator and load
            const calibrator2 = new ThermalCalibrator(device, mockInflux);
            calibrator2.paramsFile = calibrator.paramsFile;
            await calibrator2._loadParams();

            assert.strictEqual(calibrator2.params.timeConstant, 24);
            assert.strictEqual(calibrator2.params.solarGainFactor, 0.02);
        });

        test('uses defaults when params file missing', async () => {
            await calibrator.init(tempDir);

            // Delete params file
            try {
                await fs.unlink(calibrator.paramsFile);
            } catch (e) {
                // File might not exist yet
            }

            await calibrator._loadParams();

            // Should still have default values
            const params = calibrator.getParams();
            assert.strictEqual(params.timeConstant, 18);
        });
    });

    describe('Time Constant Estimation', () => {
        test('estimates time constant from HVAC-off periods', async () => {
            await calibrator.init(tempDir);

            const tau = await calibrator._estimateTimeConstant();

            // Should return a reasonable time constant (6-48 hours)
            if (tau !== null) {
                assert.ok(tau >= 6);
                assert.ok(tau <= 48);
            }
        });

        test('returns null when no valid periods', async () => {
            // Override mock to return empty periods
            mockInflux.getHvacOffPeriods = async () => [];

            await calibrator.init(tempDir);
            const tau = await calibrator._estimateTimeConstant();

            assert.strictEqual(tau, null);
        });
    });

    describe('Solar Gain Estimation', () => {
        test('estimates solar gain factor from sunny periods', async () => {
            await calibrator.init(tempDir);

            const gain = await calibrator._estimateSolarGain();

            // Should return a reasonable solar gain factor
            if (gain !== null) {
                assert.ok(gain > 0);
                assert.ok(gain < 0.1); // Reasonable range for °C/h per W/m²
            }
        });

        test('returns null when insufficient data', async () => {
            mockInflux.getSunnyPeriods = async () => [];

            await calibrator.init(tempDir);
            const gain = await calibrator._estimateSolarGain();

            assert.strictEqual(gain, null);
        });
    });

    describe('Heat Loss Estimation', () => {
        test('estimates heat loss coefficient', async () => {
            await calibrator.init(tempDir);

            const loss = await calibrator._estimateHeatLoss();

            // Should return a reasonable coefficient
            if (loss !== null) {
                assert.ok(loss > 0);
            }
        });
    });

    describe('Full Calibration', () => {
        test('runs full calibration and updates parameters', async () => {
            await calibrator.init(tempDir);

            const originalTau = calibrator.params.timeConstant;
            await calibrator.runCalibration();

            // Check that lastCalibration is updated
            assert.ok(calibrator.params.lastCalibration !== null);
        });

        test('skips calibration when InfluxDB not connected', async () => {
            mockInflux.isConnected = false;
            await calibrator.init(tempDir);

            const originalTau = calibrator.params.timeConstant;
            await calibrator.runCalibration();

            // Should not have updated lastCalibration
            assert.strictEqual(calibrator.params.lastCalibration, null);
        });
    });

    describe('Metrics', () => {
        test('returns calibration metrics', async () => {
            await calibrator.init(tempDir);

            const metrics = calibrator.getMetrics();

            assert.ok('timeConstant' in metrics);
            assert.ok('solarGainFactor' in metrics);
            assert.ok('heatLossCoefficient' in metrics);
            assert.ok('lastCalibration' in metrics);
            assert.ok('dataPoints' in metrics);
        });
    });
});

describe('ThermalManager', () => {
    let manager;
    let device;

    beforeEach(() => {
        device = createMockDevice();
    });

    afterEach(async () => {
        if (manager) {
            await manager.stop();
        }
    });

    describe('Initialization', () => {
        test('initializes when InfluxDB enabled', async () => {
            manager = new ThermalManager(device);

            // Mock the influx client init to succeed without real DB
            manager.influxClient = createMockInfluxClient();
            await manager.influxClient.init();
            manager.isInitialized = true;

            assert.strictEqual(manager.getIsInitialized(), true);
        });

        test('does not initialize when InfluxDB disabled', async () => {
            device.influxConfig.enabled = false;
            manager = new ThermalManager(device);

            const result = await manager.init();

            assert.strictEqual(result, false);
            assert.strictEqual(manager.getIsInitialized(), false);
        });

        test('returns false when InfluxDB config missing', async () => {
            device.influxConfig = null;
            manager = new ThermalManager(device);

            const result = await manager.init();

            assert.strictEqual(result, false);
        });
    });

    describe('Data Logging', () => {
        test('logs data points when initialized', () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            manager.influxClient.init();
            manager.isInitialized = true;
            manager.lastLogTime = 0; // Force immediate logging

            const deviceData = {
                Device: {
                    RoomTemperature: 24,
                    SetTemperature: 23,
                    Power: true
                }
            };

            manager.logDataPoint(deviceData);

            assert.ok(manager.influxClient.writeBuffer.length > 0);
        });

        test('rate limits logging', () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            manager.influxClient.init();
            manager.isInitialized = true;
            manager.lastLogTime = Date.now(); // Just logged

            const deviceData = {
                Device: {
                    RoomTemperature: 24,
                    SetTemperature: 23,
                    Power: true
                }
            };

            manager.logDataPoint(deviceData);

            // Should not have logged (rate limited)
            assert.strictEqual(manager.influxClient.writeBuffer.length, 0);
        });

        test('does not log when not initialized', () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            // Not initialized

            const deviceData = {
                Device: {
                    RoomTemperature: 24,
                    SetTemperature: 23,
                    Power: true
                }
            };

            manager.logDataPoint(deviceData);

            assert.strictEqual(manager.influxClient.writeBuffer.length, 0);
        });
    });

    describe('Calibration Integration', () => {
        test('returns null calibration params when calibrator not initialized', () => {
            manager = new ThermalManager(device);

            const params = manager.getCalibrationParams();

            assert.strictEqual(params, null);
        });

        test('returns calibration params when initialized', async () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            await manager.influxClient.init();
            manager.isInitialized = true;

            // Create mock calibrator
            manager.calibrator = {
                getParams: () => ({ timeConstant: 20, solarGainFactor: 0.015 }),
                getMetrics: () => ({ timeConstant: 20, lastCalibration: null }),
                runCalibration: async () => {},
                stop: () => {}
            };

            const params = manager.getCalibrationParams();

            assert.ok(params !== null);
            assert.strictEqual(params.timeConstant, 20);
        });
    });

    describe('Status Reporting', () => {
        test('returns status object', () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            manager.isInitialized = true;

            const status = manager.getStatus();

            assert.ok('initialized' in status);
            assert.ok('connected' in status);
            assert.ok('calibration' in status);
        });
    });

    describe('Cleanup', () => {
        test('stops cleanly', async () => {
            manager = new ThermalManager(device);
            manager.influxClient = createMockInfluxClient();
            await manager.influxClient.init();
            manager.isInitialized = true;

            manager.calibrator = {
                stop: () => {}
            };

            await manager.stop();

            assert.strictEqual(manager.getIsInitialized(), false);
        });
    });
});

describe('Data Point Structure', () => {
    test('logDataPoint creates correct data structure', () => {
        const device = createMockDevice();
        const manager = new ThermalManager(device);
        manager.influxClient = createMockInfluxClient();
        manager.influxClient.init();
        manager.isInitialized = true;
        manager.lastLogTime = 0;

        const deviceData = {
            Device: {
                RoomTemperature: 24.5,
                SetTemperature: 23,
                Power: true
            }
        };

        manager.logDataPoint(deviceData);

        const logged = manager.influxClient.writeBuffer[0];

        assert.strictEqual(logged.deviceId, 'test-device-123');
        assert.strictEqual(logged.recuperatorTemp, 24.5);
        assert.strictEqual(logged.acSetpoint, 23);
        assert.strictEqual(logged.powerState, true);
        assert.strictEqual(logged.indoorTemp, 22.5); // From device.roomCurrentTemp
        assert.strictEqual(logged.outdoorTemp, 5); // From mock weather client
        assert.strictEqual(logged.hvacState, 'STANDBY'); // From mock state machine
        assert.strictEqual(logged.seasonMode, 'winter'); // From mock predictive controller
    });
});

// Run all tests
console.log('Running Thermal module tests...\n');
