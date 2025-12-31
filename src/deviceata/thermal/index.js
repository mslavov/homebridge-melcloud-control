import EventEmitter from 'events';
import { InfluxClient } from './influx-client.js';
import { ThermalCalibrator } from './thermal-calibrator.js';

/**
 * ThermalManager - Orchestrates thermal data logging and learning
 *
 * Coordinates:
 * - InfluxDB data logging
 * - Thermal calibration
 * - Parameter updates to predictive controller
 */
class ThermalManager extends EventEmitter {
    constructor(device) {
        super();
        this.device = device;

        // Sub-modules
        this.influxClient = null;
        this.calibrator = null;

        // State
        this.isInitialized = false;
        this.lastLogTime = 0;
        this.logIntervalMs = 5 * 60 * 1000; // Log every 5 minutes

        // Wire up events
        this._setupEventHandlers();
    }

    /**
     * Setup event handlers for sub-modules
     */
    _setupEventHandlers() {
        // Events will be set up after modules are created
    }

    /**
     * Initialize the thermal manager
     */
    async init() {
        const config = this.device.influxConfig;

        if (!config || !config.enabled) {
            this.device.emit('debug', 'ThermalManager: Disabled (InfluxDB not configured)');
            return false;
        }

        this.device.emit('debug', 'ThermalManager: Initializing...');

        try {
            // Create InfluxDB client
            this.influxClient = new InfluxClient(config);

            // Wire up events
            this.influxClient.on('success', (msg) => this.device.emit('success', msg));
            this.influxClient.on('info', (msg) => this.device.emit('info', msg));
            this.influxClient.on('debug', (msg) => this.device.emit('debug', msg));
            this.influxClient.on('warn', (msg) => this.device.emit('warn', msg));

            // Initialize InfluxDB connection
            const connected = await this.influxClient.init();

            if (!connected) {
                this.device.emit('warn', 'ThermalManager: InfluxDB connection failed, thermal logging disabled');
                return false;
            }

            // Create and initialize calibrator
            this.calibrator = new ThermalCalibrator(this.device, this.influxClient);

            this.calibrator.on('success', (msg) => this.device.emit('success', msg));
            this.calibrator.on('info', (msg) => this.device.emit('info', msg));
            this.calibrator.on('debug', (msg) => this.device.emit('debug', msg));
            this.calibrator.on('warn', (msg) => this.device.emit('warn', msg));

            // Get storage path from Homebridge
            const storagePath = this.device.api?.user?.storagePath?.() || './';
            await this.calibrator.init(storagePath);

            this.isInitialized = true;
            this.device.emit('success', 'ThermalManager: Initialized');

            return true;
        } catch (error) {
            this.device.emit('warn', `ThermalManager: Init failed - ${error.message}`);
            return false;
        }
    }

    /**
     * Log a data point from device state
     * Called on each deviceState event
     */
    logDataPoint(deviceData) {
        if (!this.isInitialized || !this.influxClient) {
            return;
        }

        // Rate limit logging
        const now = Date.now();
        if (now - this.lastLogTime < this.logIntervalMs) {
            return;
        }
        this.lastLogTime = now;

        // Gather data from various sources
        const device = this.device;

        const data = {
            deviceId: device.deviceId?.toString() || 'unknown',
            timestamp: new Date(),

            // Indoor temperature from external sensor
            indoorTemp: device.externalTemperature,

            // AC sensor temperature (recuperator temp)
            recuperatorTemp: deviceData?.Device?.RoomTemperature,

            // Outdoor temperature from weather client
            outdoorTemp: device.predictiveController?.weatherClient?.getCurrentOutdoorTemp() || null,

            // AC setpoint
            acSetpoint: deviceData?.Device?.SetTemperature,

            // User's target preference
            userTarget: device.userTargetTemperature,

            // Solar radiation from forecast
            solarRadiation: device.predictiveController?.weatherClient?.getCurrentSolarRadiation() || null,

            // HVAC state from state machine
            hvacState: device.predictiveController?.stateMachine?.getCurrentState() || 'UNKNOWN',

            // Season mode
            seasonMode: device.predictiveController?.getSeasonMode() || 'unknown',

            // Power state
            powerState: deviceData?.Device?.Power || false
        };

        // Write to InfluxDB
        this.influxClient.writePoint(data);
    }

    /**
     * Get current calibration parameters
     */
    getCalibrationParams() {
        if (!this.calibrator) {
            return null;
        }
        return this.calibrator.getParams();
    }

    /**
     * Get validation metrics
     */
    getMetrics() {
        if (!this.calibrator) {
            return null;
        }
        return this.calibrator.getMetrics();
    }

    /**
     * Force a calibration run
     */
    async runCalibration() {
        if (!this.calibrator) {
            return false;
        }
        await this.calibrator.runCalibration();
        return true;
    }

    /**
     * Check if manager is initialized
     */
    getIsInitialized() {
        return this.isInitialized;
    }

    /**
     * Check if InfluxDB is connected
     */
    getIsConnected() {
        return this.influxClient?.getIsConnected() || false;
    }

    /**
     * Get status for logging
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            connected: this.getIsConnected(),
            calibration: this.calibrator?.getMetrics() || null
        };
    }

    /**
     * Stop the thermal manager
     */
    async stop() {
        if (this.calibrator) {
            this.calibrator.stop();
        }

        if (this.influxClient) {
            await this.influxClient.stop();
        }

        this.isInitialized = false;
        this.device.emit('debug', 'ThermalManager: Stopped');
    }
}

export { ThermalManager };
export default ThermalManager;
