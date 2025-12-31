import ShellyCloud from '../shellycloud.js';
import { AirConditioner } from '../constants.js';

/**
 * Handles external temperature sensor integration (Shelly)
 * and temperature compensation logic
 */
export class ExternalSensor {
    constructor(device) {
        this.device = device;
    }

    async init() {
        const d = this.device;

        if (d.externalSensorEnabled && d.externalSensorType === 'shelly') {
            try {
                d.shellyClient = new ShellyCloud({
                    shellyServerUri: d.externalSensorConfig.shellyServerUri,
                    shellyAuthKey: d.externalSensorConfig.shellyAuthKey,
                    shellyDeviceId: d.externalSensorConfig.shellyDeviceId,
                    logDebug: d.logDebug,
                    logWarn: d.logWarn
                })
                    .on('temperature', (temp, humidity) => {
                        d.externalTemperature = temp;
                        d.externalHumidity = humidity;
                        this.updateTemperatureOffset();
                        if (d.logDebug) d.emit('debug', `External sensor: ${temp}°C, humidity: ${humidity}%`);
                    })
                    .on('unavailable', (error) => {
                        if (d.logWarn) d.emit('warn', `External sensor unavailable: ${error.message}`);
                    })
                    .on('debug', (debug) => d.emit('debug', debug))
                    .on('warn', (warn) => d.emit('warn', warn));

                // Start polling
                d.shellyPollingInterval = setInterval(async () => {
                    await d.shellyClient.fetchTemperature();
                }, d.pollInterval);

                // Initial fetch
                await d.shellyClient.fetchTemperature();
                d.emit('success', `External Shelly sensor connected (poll: ${d.pollInterval / 1000}s)`);
            } catch (error) {
                if (d.logWarn) d.emit('warn', `Shelly sensor init error: ${error}`);
            }
        }

        return true;
    }

    async updateTemperatureOffset() {
        const d = this.device;

        if (!d.externalSensorEnabled || d.externalTemperature === null) {
            d.temperatureOffset = 0;
            return;
        }

        const acRoomTemp = d.deviceData?.Device?.RoomTemperature;
        if (acRoomTemp === null || acRoomTemp === undefined) {
            return;
        }

        // Calculate offset: positive means AC reads higher than external
        const newOffset = acRoomTemp - d.externalTemperature;
        const offsetChanged = Math.abs(newOffset - d.temperatureOffset) > 0.3;

        // Update offset
        d.temperatureOffset = newOffset;

        // Log if offset changed significantly
        if (offsetChanged && d.logInfo) {
            d.emit('info', `Temperature offset: ${d.temperatureOffset.toFixed(1)}°C (AC: ${acRoomTemp}°C, External: ${d.externalTemperature}°C)`);
        }

        // Reapply compensation if offset changed and we have a user target
        if (offsetChanged && d.compensationEnabled && d.userTargetTemperature !== null) {
            await this.reapplyCompensation();
        }
    }

    async reapplyCompensation() {
        const d = this.device;

        if (!d.compensationEnabled || !d.externalSensorEnabled || d.userTargetTemperature === null) {
            return;
        }

        const newCompensated = this.getCompensatedTargetTemperature(d.userTargetTemperature);

        // Only send if compensated value changed
        if (d.lastCompensatedTarget !== null && Math.abs(newCompensated - d.lastCompensatedTarget) < 0.5) {
            return;
        }

        try {
            const deviceData = d.deviceData;
            if (!deviceData?.Device) return;

            d.lastCompensatedTarget = newCompensated;
            deviceData.Device.SetTemperature = newCompensated;

            if (d.logInfo) {
                d.emit('info', `Reapplying compensation: user wants ${d.userTargetTemperature}°C → AC set to ${newCompensated}°C`);
            }

            await d.melCloudAta.send(d.accountType, d.displayType, deviceData, AirConditioner.EffectiveFlags.SetTemperature);
        } catch (error) {
            if (d.logWarn) d.emit('warn', `Reapply compensation error: ${error}`);
        }
    }

    getCompensatedTargetTemperature(userTarget) {
        const d = this.device;

        if (!d.compensationEnabled || !d.externalSensorEnabled) {
            return userTarget;
        }

        if (d.externalTemperature === null || Math.abs(d.temperatureOffset) < d.hysteresis) {
            return userTarget;
        }

        // Compensate: if AC reads higher, we need to set higher target
        // so AC runs until external sensor shows user's desired temp
        const compensated = userTarget + d.temperatureOffset;

        // Clamp to valid range
        const minTemp = d.accessoryState?.minTempCoolDryAuto ?? 16;
        const maxTemp = d.accessoryState?.maxTempHeat ?? 31;
        const clamped = Math.max(minTemp, Math.min(maxTemp, compensated));

        // Round to 0.5°C
        const rounded = Math.round(clamped * 2) / 2;

        if (d.logInfo && rounded !== userTarget) {
            d.emit('info', `Temperature compensation: ${userTarget}°C → ${rounded}°C (offset: ${d.temperatureOffset.toFixed(1)}°C)`);
        }

        return rounded;
    }
}
