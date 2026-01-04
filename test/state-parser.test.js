/**
 * Tests for StateParser - verifies state parsing produces correct results
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { StateParser } from '../src/deviceata/state-parser.js';
import { Characteristic } from './mocks/homebridge-api.js';
import {
    sampleDeviceData,
    heatingDeviceData,
    autoDeviceData,
    offDeviceData,
    standbyDeviceData,
    sampleAccount,
    sampleDeviceConfig,
    sampleAccountInfo
} from './fixtures/device-data.js';

// Create a minimal device context for StateParser
function createDeviceContext(deviceConfig, account = sampleAccount, accountInfo = sampleAccountInfo) {
    return {
        Characteristic,
        accountType: account.type,
        heatDryFanMode: deviceConfig.heatDryFanMode || 1,
        coolDryFanMode: deviceConfig.coolDryFanMode || 1,
        autoDryFanMode: deviceConfig.autoDryFanMode || 1,
        accountInfo,
        roomCurrentTemp: null,
        userTargetTemperature: null,
        logWarn: false,
        emit: () => {}
    };
}

describe('StateParser', () => {
    describe('HeaterCooler', () => {
        let parser;
        let deviceContext;

        beforeEach(() => {
            deviceContext = createDeviceContext(sampleDeviceConfig);
            parser = new StateParser(deviceContext);
        });

        test('parses basic device capabilities', () => {
            const state = parser.parse(sampleDeviceData);

            assert.strictEqual(state.supportsAuto, true);
            assert.strictEqual(state.supportsHeat, true);
            assert.strictEqual(state.supportsCool, true);
            assert.strictEqual(state.supportsFanSpeed, true);
            assert.strictEqual(state.supportsSwingFunction, true);
            assert.strictEqual(state.supportsWideVane, true);
            assert.strictEqual(state.numberOfFanSpeeds, 5);
        });

        test('parses temperature values correctly', () => {
            const state = parser.parse(sampleDeviceData);

            assert.strictEqual(state.roomCurrentTemp, 26.5);
            assert.strictEqual(state.acSetpoint, 24);
            assert.strictEqual(state.minTempHeat, 10);
            assert.strictEqual(state.maxTempHeat, 31);
        });

        test('parses COOL mode correctly', () => {
            const state = parser.parse(sampleDeviceData);

            // In COOL mode (3), room temp 26.5 > set temp 24
            // currentOperationMode: roomTemperature < setTemperature ? 1 (IDLE) : 3 (COOLING)
            // Since 26.5 > 24, should be COOLING (3)
            assert.strictEqual(state.currentOperationMode, 3);
            assert.strictEqual(state.targetOperationMode, 2); // COOL target
            assert.strictEqual(state.power, true);
        });

        test('parses HEAT mode correctly', () => {
            const state = parser.parse(heatingDeviceData);

            // In HEAT mode (1), room temp 18.5 < set temp 22
            // currentOperationMode: roomTemperature > setTemperature ? 1 (IDLE) : 2 (HEATING)
            // Since 18.5 < 22, should be HEATING (2)
            assert.strictEqual(state.currentOperationMode, 2);
            assert.strictEqual(state.targetOperationMode, 1); // HEAT target
        });

        test('parses AUTO mode correctly', () => {
            const state = parser.parse(autoDeviceData);

            // In AUTO mode (8), room temp 22.5 < set temp 23
            // currentOperationMode: roomTemperature > setTemperature ? 3 (COOLING) : roomTemperature < setTemperature ? 2 (HEATING) : 1 (IDLE)
            // Since 22.5 < 23, should be HEATING (2)
            assert.strictEqual(state.currentOperationMode, 2);
            assert.strictEqual(state.targetOperationMode, 0); // AUTO target
        });

        test('parses power OFF correctly', () => {
            const state = parser.parse(offDeviceData);

            // When power is off, currentOperationMode should be 0 (INACTIVE)
            assert.strictEqual(state.currentOperationMode, 0);
            assert.strictEqual(state.power, false);
        });

        test('parses standby mode correctly', () => {
            const state = parser.parse(standbyDeviceData);

            // When in standby, currentOperationMode should be 1 (IDLE)
            assert.strictEqual(state.currentOperationMode, 1);
        });

        test('parses fan speed correctly', () => {
            const state = parser.parse(sampleDeviceData);

            assert.strictEqual(state.setFanSpeed, 3);
            assert.strictEqual(state.actualFanSpeed, 3);
            // With automatic fan speed support, max fan speed should be numberOfFanSpeeds + 1
            assert.strictEqual(state.fanSpeedSetPropsMaxValue, 6);
        });

        test('parses temperature step', () => {
            const state = parser.parse(sampleDeviceData);

            // TemperatureIncrement: true means 0.5 degree steps
            assert.strictEqual(state.temperatureStep, 0.5);
        });

        test('parses lock physical controls', () => {
            const state = parser.parse(sampleDeviceData);

            // All prohibit flags are false
            assert.strictEqual(state.lockPhysicalControl, 0);
        });

        test('builds characteristics array for HeaterCooler', () => {
            const state = parser.parse(sampleDeviceData);

            assert.ok(Array.isArray(state.characteristics));
            assert.ok(state.characteristics.length > 0);

            // Should have Active, CurrentHeaterCoolerState, TargetHeaterCoolerState, etc.
            const charTypes = state.characteristics.map(c => c.type.name);
            assert.ok(charTypes.includes('Active'));
            assert.ok(charTypes.includes('CurrentHeaterCoolerState'));
            assert.ok(charTypes.includes('TargetHeaterCoolerState'));
            assert.ok(charTypes.includes('CurrentTemperature'));
        });

        test('valid operation mode values for HeaterCooler', () => {
            const state = parser.parse(sampleDeviceData);

            // For HeaterCooler with all modes supported
            assert.ok(state.operationModeSetPropsValidValues.includes(0)); // AUTO
            assert.ok(state.operationModeSetPropsValidValues.includes(1)); // HEAT
            assert.ok(state.operationModeSetPropsValidValues.includes(2)); // COOL
        });
    });

    describe('External Sensor', () => {
        test('uses external temperature when available', () => {
            const deviceContext = createDeviceContext(sampleDeviceConfig);
            deviceContext.roomCurrentTemp = 25.0; // Different from AC sensor (26.5)

            const parser = new StateParser(deviceContext);
            const state = parser.parse(sampleDeviceData);

            assert.strictEqual(state.roomCurrentTemp, 25.0);
            assert.strictEqual(state.acCurrentTemp, 26.5);
        });

        test('uses AC temperature when external sensor not available', () => {
            const deviceContext = createDeviceContext(sampleDeviceConfig);
            deviceContext.roomCurrentTemp = null; // No external reading yet
            const parser = new StateParser(deviceContext);
            const state = parser.parse(sampleDeviceData);

            assert.strictEqual(state.roomCurrentTemp, 26.5);
            assert.strictEqual(state.acCurrentTemp, 26.5);
        });

        test('uses user target temperature for display when set', () => {
            const deviceContext = createDeviceContext(sampleDeviceConfig);
            deviceContext.roomCurrentTemp = 25.0;
            deviceContext.userTargetTemperature = 23.0; // User wants 23

            const parser = new StateParser(deviceContext);
            const state = parser.parse(sampleDeviceData);

            // The characteristics should show user target, not AC set temperature
            const coolingThreshold = state.characteristics.find(
                c => c.type.name === 'CoolingThresholdTemperature'
            );
            assert.strictEqual(coolingThreshold.value, 23.0);
        });
    });
});

// Run all tests
console.log('Running StateParser tests...\n');
