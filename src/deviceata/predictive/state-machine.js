import EventEmitter from 'events';
import { States, AntiOscillation, PredictiveDefaults } from './constants.js';

/**
 * AC control state machine with anti-oscillation protection
 * Manages transitions between heating/cooling states based on temperature
 * and weather forecasts, with built-in lockout timers to prevent hunting.
 */
class StateMachine extends EventEmitter {
    constructor(device) {
        super();
        this.device = device;

        // Current state
        this.currentState = States.STANDBY;
        this.previousState = null;
        this.stateEnteredAt = Date.now();

        // State history for debugging
        this.stateHistory = [];
        this.maxHistoryLength = 50;

        // Timers
        this.timers = {
            lastOnTime: null,
            lastOffTime: null,
            lastModeSwitch: null
        };

        // Configuration (can be overridden)
        this.config = {
            deadband: AntiOscillation.DEADBAND,
            hysteresis: AntiOscillation.HYSTERESIS,
            minOnTime: AntiOscillation.MIN_ON_TIME * 1000,  // Convert to ms
            minOffTime: AntiOscillation.MIN_OFF_TIME * 1000,
            minModeSwitch: AntiOscillation.MIN_MODE_SWITCH * 1000
        };
    }

    /**
     * Get current state
     */
    getCurrentState() {
        return this.currentState;
    }

    /**
     * Get state history
     */
    getStateHistory() {
        return [...this.stateHistory];
    }

    /**
     * Get time in current state (ms)
     */
    getTimeInState() {
        return Date.now() - this.stateEnteredAt;
    }

    /**
     * Process state update and determine if action is needed
     *
     * @param {Object} params
     * @param {number} params.currentTemp - Current indoor temperature
     * @param {number} params.targetTemp - User's target temperature
     * @param {number} params.predictedSetpoint - Calculated predictive setpoint
     * @param {string} params.seasonMode - 'winter' or 'summer'
     * @param {Object} params.forecast - Forecast data (for anticipatory states)
     * @param {boolean} params.acPowerState - Current AC power state
     * @returns {Object} { state, action, reason }
     */
    processUpdate(params) {
        const {
            currentTemp,
            targetTemp,
            predictedSetpoint,
            seasonMode,
            forecast,
            acPowerState
        } = params;

        // Check for sensor fault
        if (currentTemp === null || currentTemp === undefined) {
            return this._transitionTo(States.SENSOR_FAULT, {
                action: null,
                reason: 'External temperature sensor unavailable'
            });
        }

        // Calculate temperature deviation from target
        const deviation = currentTemp - targetTemp;
        const halfDeadband = this.config.deadband / 2;

        // Determine desired state based on temperature and mode
        let desiredState = this._determineDesiredState(
            deviation,
            halfDeadband,
            seasonMode,
            forecast,
            currentTemp,
            targetTemp
        );

        // Check if transition is allowed (anti-oscillation)
        if (desiredState !== this.currentState) {
            if (!this._canTransitionTo(desiredState)) {
                // Transition blocked by timer, stay in current state
                return {
                    state: this.currentState,
                    action: null,
                    reason: 'Transition blocked by anti-oscillation timer'
                };
            }

            return this._transitionTo(desiredState, {
                action: this._getActionForState(desiredState, predictedSetpoint),
                reason: this._getReasonForTransition(this.currentState, desiredState, deviation)
            });
        }

        // No state change needed
        return {
            state: this.currentState,
            action: null,
            reason: 'Maintaining current state'
        };
    }

    /**
     * Determine the desired state based on conditions
     */
    _determineDesiredState(deviation, halfDeadband, seasonMode, forecast, currentTemp, targetTemp) {
        // Check for anticipatory states first (based on forecast)
        if (forecast) {
            const coldSnap = this._detectColdSnap(forecast);
            const heatwave = this._detectHeatwave(forecast);

            // If cold snap approaching and we're not already heating
            if (coldSnap && seasonMode === 'winter' && !this._isHeatingState()) {
                return States.PRE_HEAT;
            }

            // If heatwave approaching and we're not already cooling
            if (heatwave && seasonMode === 'summer' && !this._isCoolingState()) {
                return States.PRE_COOL;
            }
        }

        // Temperature-based state determination
        if (seasonMode === 'winter') {
            // Winter: Focus on heating
            if (deviation < -this.config.hysteresis) {
                // Too cold, need heating
                return States.HEATING_ACTIVE;
            } else if (deviation > halfDeadband) {
                // Warm enough, can stop
                return this._isHeatingState() ? States.HEATING_COAST : States.STANDBY;
            } else if (this.currentState === States.HEATING_COAST && deviation > -0.5) {
                // Coasting complete
                return States.STANDBY;
            }
        } else {
            // Summer: Focus on cooling
            if (deviation > this.config.hysteresis) {
                // Too hot, need cooling
                return States.COOLING_ACTIVE;
            } else if (deviation < -halfDeadband) {
                // Cool enough, can stop
                return this._isCoolingState() ? States.COOLING_COAST : States.STANDBY;
            } else if (this.currentState === States.COOLING_COAST && deviation < 0.5) {
                // Coasting complete
                return States.STANDBY;
            }
        }

        // Stay in current state
        return this.currentState;
    }

    /**
     * Check if transition is allowed based on anti-oscillation timers
     */
    _canTransitionTo(newState) {
        const now = Date.now();

        // Leaving an active state (turning off)
        if (this._isActiveState(this.currentState) && !this._isActiveState(newState)) {
            if (this.timers.lastOnTime && now - this.timers.lastOnTime < this.config.minOnTime) {
                return false; // Min on time not met
            }
        }

        // Entering an active state (turning on)
        if (!this._isActiveState(this.currentState) && this._isActiveState(newState)) {
            if (this.timers.lastOffTime && now - this.timers.lastOffTime < this.config.minOffTime) {
                return false; // Min off time not met
            }
        }

        // Switching modes (heat <-> cool)
        if (this._isHeatingState(this.currentState) && this._isCoolingState(newState) ||
            this._isCoolingState(this.currentState) && this._isHeatingState(newState)) {
            if (this.timers.lastModeSwitch && now - this.timers.lastModeSwitch < this.config.minModeSwitch) {
                return false; // Min mode switch time not met
            }
        }

        return true;
    }

    /**
     * Transition to new state
     */
    _transitionTo(newState, result) {
        const now = Date.now();
        const oldState = this.currentState;

        // Update timers
        if (this._isActiveState(oldState) && !this._isActiveState(newState)) {
            this.timers.lastOffTime = now;
        }
        if (!this._isActiveState(oldState) && this._isActiveState(newState)) {
            this.timers.lastOnTime = now;
        }
        if ((this._isHeatingState(oldState) && this._isCoolingState(newState)) ||
            (this._isCoolingState(oldState) && this._isHeatingState(newState))) {
            this.timers.lastModeSwitch = now;
        }

        // Update state
        this.previousState = this.currentState;
        this.currentState = newState;
        this.stateEnteredAt = now;

        // Record in history
        this.stateHistory.push({
            from: oldState,
            to: newState,
            timestamp: now,
            reason: result.reason
        });
        if (this.stateHistory.length > this.maxHistoryLength) {
            this.stateHistory.shift();
        }

        // Emit state change event
        this.emit('stateChange', {
            oldState,
            newState,
            action: result.action,
            reason: result.reason
        });

        return {
            state: newState,
            action: result.action,
            reason: result.reason
        };
    }

    /**
     * Get action for state
     */
    _getActionForState(state, predictedSetpoint) {
        switch (state) {
            case States.HEATING_ACTIVE:
            case States.PRE_HEAT:
                return {
                    type: 'setMode',
                    mode: 'heat',
                    setpoint: predictedSetpoint
                };
            case States.COOLING_ACTIVE:
            case States.PRE_COOL:
                return {
                    type: 'setMode',
                    mode: 'cool',
                    setpoint: predictedSetpoint
                };
            case States.STANDBY:
            case States.HEATING_COAST:
            case States.COOLING_COAST:
                return {
                    type: 'coast',
                    setpoint: predictedSetpoint
                };
            case States.SENSOR_FAULT:
                return null;
            default:
                return null;
        }
    }

    /**
     * Get reason for transition
     */
    _getReasonForTransition(fromState, toState, deviation) {
        const devStr = deviation !== null ? `(${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}°C)` : '';

        switch (toState) {
            case States.HEATING_ACTIVE:
                return `Starting heating - room too cold ${devStr}`;
            case States.COOLING_ACTIVE:
                return `Starting cooling - room too hot ${devStr}`;
            case States.PRE_HEAT:
                return 'Pre-heating - cold snap approaching';
            case States.PRE_COOL:
                return 'Pre-cooling - heatwave approaching';
            case States.HEATING_COAST:
                return `Coasting - target reached ${devStr}`;
            case States.COOLING_COAST:
                return `Coasting - target reached ${devStr}`;
            case States.STANDBY:
                return `Standby - temperature in comfort band ${devStr}`;
            case States.SENSOR_FAULT:
                return 'Sensor fault - no temperature data';
            default:
                return `Transition to ${toState}`;
        }
    }

    /**
     * Check if state is an active (AC running) state
     */
    _isActiveState(state = this.currentState) {
        return [
            States.HEATING_ACTIVE,
            States.COOLING_ACTIVE,
            States.PRE_HEAT,
            States.PRE_COOL
        ].includes(state);
    }

    /**
     * Check if state is a heating-related state
     */
    _isHeatingState(state = this.currentState) {
        return [States.HEATING_ACTIVE, States.PRE_HEAT, States.HEATING_COAST].includes(state);
    }

    /**
     * Check if state is a cooling-related state
     */
    _isCoolingState(state = this.currentState) {
        return [States.COOLING_ACTIVE, States.PRE_COOL, States.COOLING_COAST].includes(state);
    }

    /**
     * Detect cold snap from forecast
     */
    _detectColdSnap(forecast) {
        if (!forecast?.hourly?.length) return null;

        const temps = forecast.hourly.map(h => h.temperature).filter(t => t !== null);
        if (temps.length < 24) return null;

        const current = temps[0];
        const min48h = Math.min(...temps.slice(0, 48));
        const drop = current - min48h;

        if (drop >= PredictiveDefaults.COLD_SNAP_THRESHOLD) {
            const hoursUntil = temps.findIndex(t => t === min48h);
            // Only return if cold snap is 12-24 hours away (optimal pre-heat window)
            if (hoursUntil > 12 && hoursUntil <= 36) {
                return { hoursUntil, tempDrop: drop, minTemp: min48h };
            }
        }
        return null;
    }

    /**
     * Detect heatwave from forecast
     */
    _detectHeatwave(forecast) {
        if (!forecast?.hourly?.length) return null;

        const temps = forecast.hourly.map(h => h.temperature).filter(t => t !== null);
        if (temps.length < 24) return null;

        const max48h = Math.max(...temps.slice(0, 48));

        if (max48h >= PredictiveDefaults.HEATWAVE_THRESHOLD) {
            const hoursUntil = temps.findIndex(t => t === max48h);
            return { hoursUntil, peakTemp: max48h };
        }
        return null;
    }

    /**
     * Force transition to a specific state (for manual override)
     */
    forceState(state, reason = 'Manual override') {
        return this._transitionTo(state, {
            action: null,
            reason
        });
    }

    /**
     * Reset to standby state
     */
    reset() {
        this.currentState = States.STANDBY;
        this.previousState = null;
        this.stateEnteredAt = Date.now();
        this.timers = {
            lastOnTime: null,
            lastOffTime: null,
            lastModeSwitch: null
        };
    }
}

export { StateMachine };
export default StateMachine;
