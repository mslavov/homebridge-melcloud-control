import { PredictiveDefaults, SeasonMode } from './constants.js';

/**
 * Predictive setpoint calculator for passive house temperature control
 *
 * Algorithm layers:
 * 1. Outdoor reset curve - adjust based on current outdoor temp
 * 2. Forecast look-ahead - weight future temps by exponential decay
 * 3. Solar gain compensation - reduce heating when sun expected
 * 4. Error correction - small proportional term for current deviation
 * 5. Cold weather boost - increase setpoint for ducted AC with post-recuperator sensor
 */
class SetpointCalculator {
    constructor(device) {
        this.device = device;

        // Building parameters (can be learned over time)
        this.buildingTimeConstant = PredictiveDefaults.BUILDING_TIME_CONSTANT;
        this.solarGainFactor = PredictiveDefaults.SOLAR_GAIN_FACTOR;

        // Algorithm parameters
        this.outdoorResetSlope = PredictiveDefaults.OUTDOOR_RESET_SLOPE;
        this.decayConstant = PredictiveDefaults.DECAY_CONSTANT;
        this.forecastHorizon = PredictiveDefaults.FORECAST_HORIZON;
    }

    /**
     * Update building parameters from thermal calibration
     */
    updateBuildingParameters(params) {
        if (params.timeConstant) {
            this.buildingTimeConstant = params.timeConstant;
        }
        if (params.solarGainFactor) {
            this.solarGainFactor = params.solarGainFactor;
        }
    }

    /**
     * Calculate the predicted room target temperature
     *
     * @param {Object} params
     * @param {number} params.userComfortTarget - User's comfort preference (absolute temperature)
     * @param {number} params.currentIndoorTemp - Current room temperature (from external sensor)
     * @param {number} params.currentOutdoorTemp - Current outdoor temperature
     * @param {number[]} params.forecastTemps - Array of forecast temperatures (hourly)
     * @param {number[]} params.forecastSolar - Array of forecast solar radiation (hourly)
     * @param {string} params.seasonMode - 'winter' or 'summer'
     * @returns {Object} { predictedRoomTarget, components, reason }
     */
    calculateSetpoint(params) {
        const {
            userComfortTarget,
            currentIndoorTemp,
            currentOutdoorTemp,
            forecastTemps = [],
            forecastSolar = [],
            seasonMode = SeasonMode.WINTER
        } = params;

        // Base is user's comfort preference
        let predictedRoomTarget = userComfortTarget;
        const components = {
            base: userComfortTarget,
            outdoorReset: 0,
            forecastAdjustment: 0,
            solarOffset: 0,
            errorCorrection: 0,
            coldWeatherBoost: 0
        };
        const reasons = [];

        // Layer 1: Outdoor reset curve
        // For high-mass systems, use lower slope (0.3-0.5)
        if (currentOutdoorTemp !== null) {
            const outdoorReset = this._calculateOutdoorResetCurve(
                currentOutdoorTemp,
                seasonMode
            );
            components.outdoorReset = outdoorReset;
            predictedRoomTarget += outdoorReset;

            if (Math.abs(outdoorReset) > 0.3) {
                reasons.push(`Outdoor reset: ${outdoorReset > 0 ? '+' : ''}${outdoorReset.toFixed(1)}°C`);
            }
        }

        // Layer 2: Forecast look-ahead adjustment
        if (forecastTemps.length > 0) {
            const forecastAdjustment = this._calculateForecastAdjustment(
                forecastTemps,
                currentOutdoorTemp,
                seasonMode
            );
            components.forecastAdjustment = forecastAdjustment;
            predictedRoomTarget += forecastAdjustment;

            if (Math.abs(forecastAdjustment) > 0.3) {
                reasons.push(`Forecast: ${forecastAdjustment > 0 ? '+' : ''}${forecastAdjustment.toFixed(1)}°C`);
            }
        }

        // Layer 3: Solar gain compensation (reduce heating when sun expected)
        if (seasonMode === SeasonMode.WINTER && forecastSolar.length > 0) {
            const solarOffset = this._calculateSolarGainOffset(forecastSolar);
            components.solarOffset = solarOffset;
            predictedRoomTarget += solarOffset;

            if (Math.abs(solarOffset) > 0.3) {
                reasons.push(`Solar gain: ${solarOffset > 0 ? '+' : ''}${solarOffset.toFixed(1)}°C`);
            }
        }

        // Layer 4: Error correction (small proportional term)
        if (currentIndoorTemp !== null) {
            const errorCorrection = this._calculateErrorCorrection(
                userComfortTarget,
                currentIndoorTemp
            );
            components.errorCorrection = errorCorrection;
            predictedRoomTarget += errorCorrection;
        }

        // Layer 5: Cold weather boost (for ducted AC with post-recuperator sensor)
        // Per installer instructions: in very cold weather, increase delta to 6-8°C
        if (seasonMode === SeasonMode.WINTER && currentOutdoorTemp !== null) {
            const coldBoost = this._calculateColdWeatherBoost(currentOutdoorTemp, forecastTemps);
            components.coldWeatherBoost = coldBoost;
            predictedRoomTarget += coldBoost;

            if (coldBoost > 0) {
                reasons.push(`Cold boost: +${coldBoost.toFixed(1)}°C`);
            }
        }

        // Apply season-specific floors to prevent over-aggressive adjustments
        // In winter, allow larger positive deviation in cold weather for heating boost
        // In summer, never set more than 2°C above user comfort target
        let maxPositiveDeviation = 2.0;
        const maxNegativeDeviation = 2.0;

        // In very cold weather, allow up to +4°C above target for adequate heating delta
        if (seasonMode === SeasonMode.WINTER && currentOutdoorTemp !== null && currentOutdoorTemp < 0) {
            maxPositiveDeviation = 4.0;
        }

        if (seasonMode === SeasonMode.WINTER && predictedRoomTarget < userComfortTarget - maxNegativeDeviation) {
            predictedRoomTarget = userComfortTarget - maxNegativeDeviation;
            reasons.push('Clamped to min heating target');
        } else if (seasonMode === SeasonMode.WINTER && predictedRoomTarget > userComfortTarget + maxPositiveDeviation) {
            predictedRoomTarget = userComfortTarget + maxPositiveDeviation;
            reasons.push('Clamped to max heating target');
        } else if (seasonMode === SeasonMode.SUMMER && predictedRoomTarget > userComfortTarget + maxPositiveDeviation) {
            predictedRoomTarget = userComfortTarget + maxPositiveDeviation;
            reasons.push('Clamped to max cooling target');
        }

        // Clamp to reasonable range
        const minTarget = 16;
        const maxTarget = 30;
        predictedRoomTarget = Math.max(minTarget, Math.min(maxTarget, predictedRoomTarget));

        // Round to 0.5°C steps
        predictedRoomTarget = Math.round(predictedRoomTarget * 2) / 2;

        return {
            predictedRoomTarget,
            components,
            reason: reasons.length > 0 ? reasons.join(', ') : 'Normal operation'
        };
    }

    /**
     * Calculate outdoor reset curve adjustment
     * As outdoor temp drops, increase heating setpoint
     * As outdoor temp rises, decrease cooling setpoint
     */
    _calculateOutdoorResetCurve(outdoorTemp, seasonMode) {
        // Design outdoor temp assumption (where no adjustment needed)
        const designOutdoorTemp = seasonMode === SeasonMode.WINTER ? 10 : 25;

        // Calculate reset offset
        // In winter: colder outdoor = higher setpoint
        // In summer: hotter outdoor = lower setpoint
        const tempDiff = designOutdoorTemp - outdoorTemp;
        let offset = this.outdoorResetSlope * tempDiff;

        // Limit the adjustment
        offset = Math.max(-2, Math.min(2, offset));

        return offset;
    }

    /**
     * Calculate forecast look-ahead adjustment
     * Weight future temps by exponential decay based on building time constant
     */
    _calculateForecastAdjustment(forecastTemps, currentOutdoorTemp, seasonMode) {
        if (!forecastTemps.length || currentOutdoorTemp === null) {
            return 0;
        }

        // Calculate weighted average of future temperatures
        let weightedSum = 0;
        let totalWeight = 0;

        for (let i = 0; i < Math.min(forecastTemps.length, this.forecastHorizon); i++) {
            // Exponential decay weight: more weight to near-term forecast
            const weight = Math.exp(-i / this.decayConstant);
            weightedSum += forecastTemps[i] * weight;
            totalWeight += weight;
        }

        const weightedFutureTemp = totalWeight > 0 ? weightedSum / totalWeight : currentOutdoorTemp;

        // Adjustment based on expected temperature change
        const expectedChange = weightedFutureTemp - currentOutdoorTemp;
        let adjustment = 0.3 * expectedChange;

        // In winter, if it's getting colder, increase setpoint slightly to preheat
        // In summer, if it's getting hotter, decrease setpoint slightly to precool
        if (seasonMode === SeasonMode.WINTER) {
            adjustment = -adjustment; // Colder future = positive adjustment (preheat)
        }

        // Limit the adjustment
        return Math.max(-1, Math.min(1, adjustment));
    }

    /**
     * Calculate solar gain offset
     * Reduce heating setpoint when significant solar radiation expected
     */
    _calculateSolarGainOffset(forecastSolar) {
        // Average solar radiation over next 6 hours
        const next6Hours = forecastSolar.slice(0, 6);
        if (!next6Hours.length) return 0;

        const avgSolar = next6Hours.reduce((a, b) => a + b, 0) / next6Hours.length;

        // If significant solar radiation expected, reduce heating
        if (avgSolar > PredictiveDefaults.SOLAR_REDUCTION_THRESHOLD) {
            // Reduce by ~0.02°C per W/m² above threshold
            const reduction = 0.02 * (avgSolar - PredictiveDefaults.SOLAR_REDUCTION_THRESHOLD);
            return Math.max(-2, -reduction);
        }

        return 0;
    }

    /**
     * Calculate error correction (proportional term)
     * Small correction based on current deviation from target
     */
    _calculateErrorCorrection(targetTemp, currentTemp) {
        const error = targetTemp - currentTemp;
        // Small proportional gain
        const Kp = 0.3;
        const correction = Kp * error;

        // Limit correction to prevent overcorrection
        return Math.max(-1, Math.min(1, correction));
    }

    /**
     * Calculate cold weather boost for ducted AC with post-recuperator sensor
     *
     * Per installer instructions (docs/installer-instructions.md):
     * - Below 5°C: delta 3-5°C above AC sensor
     * - Very cold: delta 6-8°C above AC sensor
     *
     * The AC sensor reads post-recuperator air (17-20°C), not room temp.
     * We need to boost setpoint to ensure adequate heating delta.
     */
    _calculateColdWeatherBoost(outdoorTemp, forecastTemps) {
        let boost = 0;

        // Current outdoor temperature determines base boost
        if (outdoorTemp < -5) {
            boost = 3; // Extreme cold: need maximum heating power
        } else if (outdoorTemp < 0) {
            boost = 2; // Very cold: high heating power
        } else if (outdoorTemp < 5) {
            boost = 1; // Cold: moderate heating boost
        }

        // Additional boost if extreme cold is forecast in next 24 hours
        // This enables pre-heating before the cold arrives
        if (forecastTemps && forecastTemps.length > 0) {
            const minForecast = Math.min(...forecastTemps.slice(0, 24));
            if (minForecast < -5 && boost < 3) {
                // Extreme cold coming - boost to at least 2
                boost = Math.max(boost, 2);
            } else if (minForecast < 0 && boost < 2) {
                // Very cold coming - boost to at least 1
                boost = Math.max(boost, 1);
            }
        }

        return boost;
    }

    /**
     * Detect if a cold snap is approaching
     * Returns hours until coldest point, or null if no cold snap detected
     */
    detectColdSnap(forecastTemps, currentOutdoorTemp) {
        if (!forecastTemps.length || currentOutdoorTemp === null) {
            return null;
        }

        // Find minimum temperature in next 48 hours
        const minTemp = Math.min(...forecastTemps.slice(0, 48));
        const tempDrop = currentOutdoorTemp - minTemp;

        if (tempDrop >= PredictiveDefaults.COLD_SNAP_THRESHOLD) {
            // Find hours until coldest point
            const hoursUntilColdest = forecastTemps.findIndex(t => t === minTemp);
            return {
                hoursUntil: hoursUntilColdest,
                tempDrop,
                minTemp
            };
        }

        return null;
    }

    /**
     * Detect if a heatwave is approaching
     */
    detectHeatwave(forecastTemps) {
        if (!forecastTemps.length) {
            return null;
        }

        // Find maximum temperature in next 48 hours
        const maxTemp = Math.max(...forecastTemps.slice(0, 48));

        if (maxTemp >= PredictiveDefaults.HEATWAVE_THRESHOLD) {
            const hoursUntilPeak = forecastTemps.findIndex(t => t === maxTemp);
            return {
                hoursUntil: hoursUntilPeak,
                peakTemp: maxTemp
            };
        }

        return null;
    }

    /**
     * Check if it's a good time for night cooling (summer)
     */
    isNightCoolingTime(forecastTemps, currentIndoorTemp) {
        const hour = new Date().getHours();

        // Only during night hours
        if (hour < PredictiveDefaults.NIGHT_COOLING_START_HOUR &&
            hour > PredictiveDefaults.NIGHT_COOLING_END_HOUR) {
            return false;
        }

        // Check if outdoor is cooler than indoor
        const outdoorTemp = forecastTemps[0];
        if (outdoorTemp === null || currentIndoorTemp === null) {
            return false;
        }

        // Outdoor should be at least 2°C cooler and above 16°C
        return outdoorTemp < currentIndoorTemp - 2 && outdoorTemp > 16;
    }
}

export { SetpointCalculator };
export default SetpointCalculator;
