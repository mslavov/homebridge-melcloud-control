import { AirConditioner } from '../constants.js';

/**
 * ActionExecutor - Translates state machine decisions into MELCloud API calls
 *
 * Executes autonomous AC control based on predictive state machine actions.
 * Includes rate limiting and safety checks.
 */
class ActionExecutor {
    constructor(device) {
        this.device = device;
        this.lastActionTime = null;
        this.minActionInterval = 60000; // 60 seconds minimum between actions
    }

    /**
     * Execute an action from the state machine
     * @param {Object} stateResult - Result from StateMachine.processUpdate()
     */
    async executeAction(stateResult) {
        const { state, action, reason } = stateResult;

        // No action needed
        if (!action) return;

        // Rate limiting
        const now = Date.now();
        if (this.lastActionTime && (now - this.lastActionTime) < this.minActionInterval) {
            this.device.emit('debug', `ActionExecutor: Rate limited (${Math.round((now - this.lastActionTime) / 1000)}s since last)`);
            return;
        }

        const d = this.device;

        try {
            switch (action.type) {
                case 'setMode':
                    await this._executeSetMode(action);
                    break;
                case 'coast':
                    await this._executeCoast(action);
                    break;
            }
            this.lastActionTime = now;
        } catch (error) {
            d.emit('warn', `ActionExecutor error: ${error.message}`);
        }
    }

    /**
     * Execute setMode action (power on + set mode + set temperature)
     */
    async _executeSetMode(action) {
        const d = this.device;
        const mode = action.mode === 'heat' ? 1 : 3; // 1=Heat, 3=Cool
        const setpoint = d.externalSensor.getCompensatedTargetTemperature(action.setpoint);

        // Update device data
        d.deviceData.Device.Power = true;
        d.deviceData.Device.OperationMode = mode;
        d.deviceData.Device.SetTemperature = setpoint;

        d.emit('info', `Auto: Power ON, ${action.mode}, ${action.setpoint}°C (compensated: ${setpoint}°C)`);

        // Use combined flag for efficiency
        await d.melCloudAta.send(
            d.accountType,
            d.displayType,
            d.deviceData,
            AirConditioner.EffectiveFlags.PowerOperationModeSetTemperature
        );
    }

    /**
     * Execute coast action (update setpoint only, maintain current mode)
     */
    async _executeCoast(action) {
        const d = this.device;
        const setpoint = d.externalSensor.getCompensatedTargetTemperature(action.setpoint);

        d.deviceData.Device.SetTemperature = setpoint;

        d.emit('info', `Auto: Coast to ${action.setpoint}°C (compensated: ${setpoint}°C)`);

        await d.melCloudAta.send(
            d.accountType,
            d.displayType,
            d.deviceData,
            AirConditioner.EffectiveFlags.SetTemperature
        );
    }
}

export { ActionExecutor };
export default ActionExecutor;
