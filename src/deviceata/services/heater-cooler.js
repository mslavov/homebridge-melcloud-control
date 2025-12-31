import { AirConditioner, TemperatureDisplayUnits } from '../../constants.js';

/**
 * HeaterCooler service for displayType 1
 */
export class HeaterCoolerService {
    constructor(device) {
        this.device = device;
    }

    create(accessory, serviceName, deviceId) {
        const d = this.device;
        const Service = d.Service;
        const Characteristic = d.Characteristic;
        const state = d.accessoryState;

        if (d.logDebug) d.emit('debug', `Prepare heater/cooler service`);

        const service = new Service.HeaterCooler(serviceName, `HeaterCooler ${deviceId}`);
        service.setPrimaryService(true);

        // Active (power)
        service.getCharacteristic(Characteristic.Active)
            .onGet(async () => d.accessoryState.power)
            .onSet(async (value) => {
                try {
                    d.deviceData.Device.Power = value ? true : false;
                    if (d.logInfo) d.emit('info', `Set power: ${value ? 'On' : 'Off'}`);
                    await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.Power);
                } catch (error) {
                    if (d.logWarn) d.emit('warn', `Set power error: ${error}`);
                }
            });

        // Current state
        service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(async () => d.accessoryState.currentOperationMode);

        // Target state
        service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
                minValue: state.operationModeSetPropsMinValue,
                maxValue: state.operationModeSetPropsMaxValue,
                validValues: state.operationModeSetPropsValidValues
            })
            .onGet(async () => d.accessoryState.targetOperationMode)
            .onSet(async (value) => {
                try {
                    switch (value) {
                        case 0: value = d.autoDryFanMode; break;
                        case 1: value = d.heatDryFanMode; break;
                        case 2: value = d.coolDryFanMode; break;
                    }
                    d.deviceData.Device.OperationMode = value;
                    if (d.logInfo) d.emit('info', `Set operation mode: ${AirConditioner.OperationModeMapEnumToString[value]}`);
                    await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.OperationMode);
                } catch (error) {
                    if (d.logWarn) d.emit('warn', `Set operation mode error: ${error}`);
                }
            });

        // Current temperature
        service.getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(async () => d.accessoryState.roomTemperature);

        // Fan speed
        if (state.supportsFanSpeed) {
            service.getCharacteristic(Characteristic.RotationSpeed)
                .setProps({
                    minValue: 0,
                    maxValue: state.fanSpeedSetPropsMaxValue,
                    minStep: 1
                })
                .onGet(async () => d.accessoryState.currentFanSpeed)
                .onSet(async (value) => {
                    try {
                        const fanKey = d.accountType === 'melcloud' ? 'FanSpeed' : 'SetFanSpeed';
                        const numSpeeds = d.accessoryState.numberOfFanSpeeds;
                        const autoFan = d.accessoryState.supportsAutomaticFanSpeed;

                        switch (numSpeeds) {
                            case 2: value = autoFan ? [0, 1, 2, 0][value] : [1, 1, 2][value]; break;
                            case 3: value = autoFan ? [0, 1, 2, 3, 0][value] : [1, 1, 2, 3][value]; break;
                            case 4: value = autoFan ? [0, 1, 2, 3, 4, 0][value] : [1, 1, 2, 3, 4][value]; break;
                            case 5: value = autoFan ? [0, 1, 2, 3, 4, 5, 0][value] : [1, 1, 2, 3, 4, 5][value]; break;
                        }

                        d.deviceData.Device[fanKey] = value;
                        if (d.logInfo) d.emit('info', `Set fan speed mode: ${AirConditioner.FanSpeedMapEnumToString[value]}`);
                        await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.SetFanSpeed);
                    } catch (error) {
                        if (d.logWarn) d.emit('warn', `Set fan speed mode error: ${error}`);
                    }
                });
        }

        // Swing mode
        if (state.supportsSwingFunction) {
            service.getCharacteristic(Characteristic.SwingMode)
                .onGet(async () => d.accessoryState.currentSwingMode)
                .onSet(async (value) => {
                    try {
                        if (d.accessoryState.supportsWideVane) {
                            d.deviceData.Device.VaneHorizontalDirection = value ? 12 : 0;
                        }
                        d.deviceData.Device.VaneVerticalDirection = value ? 7 : 0;
                        if (d.logInfo) d.emit('info', `Set air direction mode: ${AirConditioner.AirDirectionMapEnumToString[value]}`);
                        await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.VaneVerticalVaneHorizontal);
                    } catch (error) {
                        if (d.logWarn) d.emit('warn', `Set air direction mode error: ${error}`);
                    }
                });
        }

        // Cooling threshold temperature
        service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: state.minTempCoolDryAuto,
                maxValue: state.maxTempCoolDryAuto,
                minStep: state.temperatureStep
            })
            .onGet(async () => {
                if (d.externalSensorEnabled && d.userTargetTemperature !== null) {
                    return d.userTargetTemperature;
                }
                const s = d.accessoryState;
                return s.operationMode === 8 ? s.defaultCoolingSetTemperature : s.setTemperature;
            })
            .onSet(async (value) => {
                try {
                    d.userTargetTemperature = value;
                    const tempKey = d.accessoryState.operationMode === 8 ? 'DefaultCoolingSetTemperature' : 'SetTemperature';
                    const compensatedValue = d.externalSensor.getCompensatedTargetTemperature(value);
                    d.lastCompensatedTarget = compensatedValue;
                    d.deviceData.Device[tempKey] = compensatedValue < 16 ? 16 : compensatedValue;
                    if (d.logInfo) d.emit('info', `Set cooling threshold temperature: ${value}${d.accessoryState.temperatureUnit}`);
                    await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.SetTemperature);
                } catch (error) {
                    if (d.logWarn) d.emit('warn', `Set cooling threshold temperature error: ${error}`);
                }
            });

        // Heating threshold temperature
        if (state.supportsHeat) {
            service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                .setProps({
                    minValue: state.minTempHeat,
                    maxValue: state.maxTempHeat,
                    minStep: state.temperatureStep
                })
                .onGet(async () => {
                    if (d.externalSensorEnabled && d.userTargetTemperature !== null) {
                        return d.userTargetTemperature;
                    }
                    const s = d.accessoryState;
                    return s.operationMode === 8 ? s.defaultHeatingSetTemperature : s.setTemperature;
                })
                .onSet(async (value) => {
                    try {
                        d.userTargetTemperature = value;
                        const tempKey = d.accessoryState.operationMode === 8 ? 'DefaultHeatingSetTemperature' : 'SetTemperature';
                        const compensatedValue = d.externalSensor.getCompensatedTargetTemperature(value);
                        d.lastCompensatedTarget = compensatedValue;
                        d.deviceData.Device[tempKey] = compensatedValue;
                        if (d.logInfo) d.emit('info', `Set heating threshold temperature: ${value}${d.accessoryState.temperatureUnit}`);
                        await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.SetTemperature);
                    } catch (error) {
                        if (d.logWarn) d.emit('warn', `Set heating threshold temperature error: ${error}`);
                    }
                });
        }

        // Lock physical controls
        service.getCharacteristic(Characteristic.LockPhysicalControls)
            .onGet(async () => d.accessoryState.lockPhysicalControl)
            .onSet(async (value) => {
                if (d.account.type === 'melcloudhome') return;
                try {
                    value = value ? true : false;
                    d.deviceData.Device.ProhibitSetTemperature = value;
                    d.deviceData.Device.ProhibitOperationMode = value;
                    d.deviceData.Device.ProhibitPower = value;
                    if (d.logInfo) d.emit('info', `Set local physical controls: ${value ? 'Lock' : 'Unlock'}`);
                    await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, AirConditioner.EffectiveFlags.Prohibit);
                } catch (error) {
                    if (d.logWarn) d.emit('warn', `Set lock physical controls error: ${error}`);
                }
            });

        // Temperature display units
        service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(async () => d.accessoryState.useFahrenheit)
            .onSet(async (value) => {
                if (d.account.type === 'melcloudhome') return;
                try {
                    d.accessoryState.useFahrenheit = value ? true : false;
                    d.accountInfo.UseFahrenheit = value ? true : false;
                    if (d.logInfo) d.emit('info', `Set temperature display unit: ${TemperatureDisplayUnits[value]}`);
                    await d.melCloudAta.send(d.accountType, d.displayType, d.deviceData, 'account', d.accountInfo);
                } catch (error) {
                    if (d.logWarn) d.emit('warn', `Set temperature display unit error: ${error}`);
                }
            });

        accessory.addService(service);
        return service;
    }
}
