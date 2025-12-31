import { TemperatureDisplayUnits } from '../constants.js';

/**
 * Parses MELCloud device state into normalized accessory state
 */
export class StateParser {
    constructor(device) {
        this.device = device;
    }

    parse(deviceData) {
        const d = this.device;
        const Characteristic = d.Characteristic;

        // Account type specific keys
        const accountTypeMelcloud = d.accountType === 'melcloud';
        const fanKey = accountTypeMelcloud ? 'FanSpeed' : 'SetFanSpeed';
        const tempStepKey = accountTypeMelcloud ? 'TemperatureIncrement' : 'HasHalfDegreeIncrements';
        const supportSwingKey = accountTypeMelcloud ? 'SwingFunction' : 'HasSwing';
        const supportWideVaneKey = accountTypeMelcloud ? 'ModelSupportsWideVane' : 'SupportsWideVane';
        const supportAutoKey = accountTypeMelcloud ? 'ModelSupportsAuto' : 'HasAutoOperationMode';
        const supportHeatKey = accountTypeMelcloud ? 'ModelSupportsHeat' : 'HasHeatOperationMode';

        // Device capabilities
        const supportsAutomaticFanSpeed = deviceData.Device.HasAutomaticFanSpeed ?? false;
        const supportsSwingFunction = deviceData.Device[supportSwingKey];
        const supportsWideVane = deviceData.Device[supportWideVaneKey];
        const supportsFanSpeed = accountTypeMelcloud ? deviceData.Device.ModelSupportsFanSpeed : deviceData.Device.NumberOfFanSpeeds > 0;
        const supportsAuto1 = deviceData.Device[supportAutoKey];
        const supportsAuto = d.autoDryFanMode >= 1 && supportsAuto1;
        const supportsHeat1 = deviceData.Device[supportHeatKey];
        const supportsHeat = d.heatDryFanMode >= 1 && supportsHeat1;
        const supportsCool = d.coolDryFanMode >= 1;
        const numberOfFanSpeeds = deviceData.Device.NumberOfFanSpeeds;
        const minTempHeat = deviceData.Device.MinTempHeat ?? 10;
        const maxTempHeat = deviceData.Device.MaxTempHeat ?? 31;
        const minTempCoolDryAuto = accountTypeMelcloud ? 4 : deviceData.Device.MinTempAutomatic ?? 16;
        const maxTempCoolDryAuto = deviceData.Device.MaxTempAutomatic ?? 31;

        // Device state
        const power = deviceData.Device.Power ?? false;
        const inStandbyMode = deviceData.Device.InStandbyMode;
        const acRoomTemperature = deviceData.Device.RoomTemperature;

        // Use external sensor temperature if available
        const roomTemperature = (d.externalSensorEnabled && d.externalTemperature !== null)
            ? d.externalTemperature
            : acRoomTemperature;

        const setTemperature = deviceData.Device.SetTemperature;
        const defaultHeatingSetTemperature = deviceData.Device.DefaultHeatingSetTemperature;
        const defaultCoolingSetTemperature = deviceData.Device.DefaultCoolingSetTemperature;
        const actualFanSpeed = deviceData.Device.ActualFanSpeed;
        const automaticFanSpeed = deviceData.Device.AutomaticFanSpeed;
        const setFanSpeed = deviceData.Device[fanKey];
        const operationMode = deviceData.Device.OperationMode;
        const vaneVerticalDirection = deviceData.Device.VaneVerticalDirection;
        const vaneHorizontalDirection = deviceData.Device.VaneHorizontalDirection;
        const prohibitSetTemperature = deviceData.Device.ProhibitSetTemperature ?? false;
        const prohibitOperationMode = deviceData.Device.ProhibitOperationMode ?? false;
        const prohibitPower = deviceData.Device.ProhibitPower ?? false;
        const temperatureStep = deviceData.Device[tempStepKey] ? 0.5 : 1;
        const currentSwingMode = supportsSwingFunction
            ? (supportsWideVane
                ? (vaneHorizontalDirection === 12 && vaneVerticalDirection === 7 ? 1 : 0)
                : (vaneVerticalDirection === 7 ? 1 : 0))
            : 0;

        // Build accessory state object
        const state = {
            // Capabilities
            supportsAutomaticFanSpeed,
            supportsSwingFunction,
            supportsWideVane,
            numberOfFanSpeeds,
            supportsFanSpeed,
            supportsAuto,
            supportsHeat,
            supportsCool,
            minTempHeat,
            maxTempHeat,
            minTempCoolDryAuto,
            maxTempCoolDryAuto,

            // State
            power,
            operationMode,
            currentOperationMode: 0,
            targetOperationMode: 0,
            roomTemperature,
            acRoomTemperature,
            setTemperature,
            defaultHeatingSetTemperature,
            defaultCoolingSetTemperature,
            actualFanSpeed,
            automaticFanSpeed,
            setFanSpeed,
            vaneVerticalDirection,
            vaneHorizontalDirection,
            currentSwingMode,
            lockPhysicalControl: prohibitSetTemperature && prohibitOperationMode && prohibitPower ? 1 : 0,
            temperatureStep,
            useFahrenheit: d.accountInfo.useFahrenheit ? 1 : 0,
            temperatureUnit: TemperatureDisplayUnits[d.accountInfo.useFahrenheit ? 1 : 0]
        };

        // Parse operation modes for HeaterCooler
        this.parseOperationModes(state, roomTemperature, setTemperature, operationMode, power, inStandbyMode);

        // Build characteristics for main service update
        state.characteristics = this.buildCharacteristics(state, Characteristic);

        return state;
    }

    parseOperationModes(state, roomTemperature, setTemperature, operationMode, power, inStandbyMode) {
        const d = this.device;
        const operationModeValidValues = [];

        // Helper to map DRY/FAN modes
        const resolveTargetHeaterCooler = (modeValue) => {
            return d.autoDryFanMode === modeValue ? 0 : d.heatDryFanMode === modeValue ? 1 : d.coolDryFanMode === modeValue ? 2 : 0;
        };

        switch (operationMode) {
            case 1: // HEAT
                state.currentOperationMode = roomTemperature > setTemperature ? 1 : 2;
                state.targetOperationMode = 1;
                break;
            case 2: // DRY
                state.currentOperationMode = 1;
                state.targetOperationMode = resolveTargetHeaterCooler(2);
                break;
            case 3: // COOL
                state.currentOperationMode = roomTemperature < setTemperature ? 1 : 3;
                state.targetOperationMode = 2;
                break;
            case 7: // FAN
                state.currentOperationMode = 1;
                state.targetOperationMode = resolveTargetHeaterCooler(3);
                break;
            case 8: // AUTO
                state.currentOperationMode = roomTemperature > setTemperature ? 3 : roomTemperature < setTemperature ? 2 : 1;
                state.targetOperationMode = 0;
                break;
            case 9: // ISEE HEAT
                state.currentOperationMode = roomTemperature > setTemperature ? 1 : 2;
                state.targetOperationMode = 1;
                break;
            case 10: // ISEE DRY
                state.currentOperationMode = 1;
                state.targetOperationMode = resolveTargetHeaterCooler(2);
                break;
            case 11: // ISEE COOL
                state.currentOperationMode = roomTemperature < setTemperature ? 1 : 3;
                state.targetOperationMode = 2;
                break;
            default:
                if (d.logWarn) d.emit('warn', `Unknown operating mode: ${operationMode}`);
        }

        state.currentOperationMode = !power ? 0 : (inStandbyMode ? 1 : state.currentOperationMode);

        if (state.supportsAuto) operationModeValidValues.push(0);
        if (state.supportsHeat) operationModeValidValues.push(1);
        operationModeValidValues.push(2);

        // Fan speed calculation
        if (state.supportsFanSpeed) {
            const max = state.numberOfFanSpeeds;
            const autoIndex = state.supportsAutomaticFanSpeed ? max + 1 : 0;
            const speeds = [autoIndex];
            for (let i = 1; i <= max; i++) speeds.push(i);
            state.currentFanSpeed = speeds[state.setFanSpeed];
            state.fanSpeedSetPropsMaxValue = state.supportsAutomaticFanSpeed ? max + 1 : max;
        }

        state.operationModeSetPropsMinValue = operationModeValidValues[0];
        state.operationModeSetPropsMaxValue = operationModeValidValues.at(-1);
        state.operationModeSetPropsValidValues = operationModeValidValues;
    }

    buildCharacteristics(state, Characteristic) {
        const d = this.device;
        const characteristics = [];

        // Get display temperature (user target if external sensor, else set temperature)
        const displayTemp = d.externalSensorEnabled && d.userTargetTemperature !== null
            ? d.userTargetTemperature
            : state.setTemperature;

        characteristics.push(
            { type: Characteristic.Active, value: state.power },
            { type: Characteristic.CurrentHeaterCoolerState, value: state.currentOperationMode },
            { type: Characteristic.TargetHeaterCoolerState, value: state.targetOperationMode },
            { type: Characteristic.CurrentTemperature, value: state.roomTemperature },
            { type: Characteristic.LockPhysicalControls, value: state.lockPhysicalControl },
            { type: Characteristic.TemperatureDisplayUnits, value: state.useFahrenheit },
            { type: Characteristic.CoolingThresholdTemperature, value: state.operationMode === 8 ? state.defaultCoolingSetTemperature : displayTemp }
        );

        if (state.supportsHeat) {
            characteristics.push({ type: Characteristic.HeatingThresholdTemperature, value: state.operationMode === 8 ? state.defaultHeatingSetTemperature : displayTemp });
        }
        if (state.supportsFanSpeed) {
            characteristics.push({ type: Characteristic.RotationSpeed, value: state.currentFanSpeed });
        }
        if (state.supportsSwingFunction) {
            characteristics.push({ type: Characteristic.SwingMode, value: state.currentSwingMode });
        }

        return characteristics;
    }
}
