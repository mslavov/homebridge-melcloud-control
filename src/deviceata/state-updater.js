import { AirConditioner } from '../constants.js';

/**
 * Updates HomeKit services from parsed accessory state
 */
export class StateUpdater {
    constructor(device) {
        this.device = device;
    }

    update() {
        const d = this.device;
        const state = d.accessoryState;
        const services = d.services;

        if (!state || !services) return;

        // Update main service characteristics
        for (const { type, value } of state.characteristics || []) {
            if (!d.functions.isValidValue(value)) continue;
            services.main?.updateCharacteristic(type, value);
        }
    }

    logState() {
        const d = this.device;
        const state = d.accessoryState;

        if (!d.logInfo || !state) return;

        d.emit('info', `Power: ${state.power ? 'On' : 'Off'}`);
        d.emit('info', `Target operation mode: ${AirConditioner.OperationModeMapEnumToString[state.operationMode]}`);
        d.emit('info', `Current operation mode: ${AirConditioner.CurrentOperationModeMapEnumToStringHeatherCooler[state.currentOperationMode]}`);
        d.emit('info', `Target temperature: ${state.setTemperature}${state.temperatureUnit}`);
        d.emit('info', `Current temperature: ${state.roomTemperature}${state.temperatureUnit}`);

        if (state.supportsFanSpeed) {
            d.emit('info', `Target fan speed: ${AirConditioner.FanSpeedMapEnumToString[state.setFanSpeed]}`);
            d.emit('info', `Current fan speed: ${AirConditioner.AktualFanSpeedMapEnumToString[state.actualFanSpeed]}`);
        }
        if (state.vaneHorizontalDirection !== null) {
            d.emit('info', `Vane horizontal: ${AirConditioner.VaneHorizontalDirectionMapEnumToString[state.vaneHorizontalDirection]}`);
        }
        if (state.vaneVerticalDirection !== null) {
            d.emit('info', `Vane vertical: ${AirConditioner.VaneVerticalDirectionMapEnumToString[state.vaneVerticalDirection]}`);
        }
        if (state.supportsSwingFunction) {
            d.emit('info', `Air direction: ${AirConditioner.AirDirectionMapEnumToString[state.currentSwingMode]}`);
        }
        d.emit('info', `Temperature display unit: ${state.temperatureUnit}`);
        d.emit('info', `Lock physical controls: ${state.lockPhysicalControl ? 'Locked' : 'Unlocked'}`);

        if (d.accountType === 'melcloudhome') {
            d.emit('info', `Signal strength: ${d.deviceData.Rssi}dBm`);
        }
    }
}
