import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * Thermal Calibrator - Learns building thermal parameters from logged data
 *
 * Calculates:
 * - Time constant (tau): How fast the building loses/gains heat
 * - Solar gain factor: How much solar radiation affects indoor temp
 * - Heat loss coefficient: Relationship between outdoor temp diff and heat loss
 */
class ThermalCalibrator extends EventEmitter {
    constructor(device, influxClient) {
        super();
        this.device = device;
        this.influxClient = influxClient;

        this.deviceId = device.deviceId?.toString() || 'unknown';
        this.paramsFile = null;

        // Default parameters (will be updated by calibration)
        this.params = {
            timeConstant: 18,           // hours
            solarGainFactor: 0.015,     // °C per W/m²
            heatLossCoefficient: 0.05,  // °C/h per °C outdoor diff
            lastCalibration: null,
            dataPoints: 0
        };

        // Calibration schedule
        this.calibrationHour = 3; // Run at 3 AM
        this.calibrationTimeout = null;
        this.calibrationInterval = null;
    }

    /**
     * Initialize the calibrator
     * @param {string} storagePath - Path to store calibration data
     */
    async init(storagePath) {
        // Set up params file path
        const melcloudDir = path.join(storagePath, 'melcloud');
        this.paramsFile = path.join(melcloudDir, `${this.deviceId}_thermal_params.json`);

        // Ensure directory exists
        try {
            await fs.mkdir(melcloudDir, { recursive: true });
        } catch (error) {
            // Directory may already exist
        }

        // Load existing parameters
        await this._loadParams();

        // Schedule daily calibration
        this._scheduleCalibration();

        this.emit('debug', `ThermalCalibrator: Initialized for device ${this.deviceId}`);
        return true;
    }

    /**
     * Load parameters from file
     */
    async _loadParams() {
        try {
            const data = await fs.readFile(this.paramsFile, 'utf8');
            const saved = JSON.parse(data);
            this.params = { ...this.params, ...saved };
            this.emit('debug', `ThermalCalibrator: Loaded params - tau=${this.params.timeConstant}h`);
        } catch (error) {
            // File doesn't exist or is invalid, use defaults
            this.emit('debug', 'ThermalCalibrator: Using default parameters');
        }
    }

    /**
     * Save parameters to file
     */
    async _saveParams() {
        try {
            await fs.writeFile(this.paramsFile, JSON.stringify(this.params, null, 2));
            this.emit('debug', 'ThermalCalibrator: Parameters saved');
        } catch (error) {
            this.emit('warn', `ThermalCalibrator: Failed to save params - ${error.message}`);
        }
    }

    /**
     * Schedule daily calibration at configured hour
     */
    _scheduleCalibration() {
        const now = new Date();
        const nextRun = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            this.calibrationHour,
            0,
            0
        );

        // If we've passed the scheduled time today, run tomorrow
        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        const msUntilRun = nextRun - now;

        // Schedule first run (store timeout ID so it can be cancelled)
        this.calibrationTimeout = setTimeout(() => {
            this.runCalibration();
            // Then run every 24 hours
            this.calibrationInterval = setInterval(() => this.runCalibration(), 24 * 60 * 60 * 1000);
        }, msUntilRun);

        this.emit('debug', `ThermalCalibrator: Next calibration scheduled in ${Math.round(msUntilRun / 1000 / 60)} minutes`);
    }

    /**
     * Run full calibration
     */
    async runCalibration() {
        if (!this.influxClient?.getIsConnected()) {
            this.emit('debug', 'ThermalCalibrator: Skipping calibration - InfluxDB not connected');
            return;
        }

        this.emit('info', 'ThermalCalibrator: Starting calibration...');

        try {
            // Estimate time constant from HVAC-off periods
            const timeConstant = await this._estimateTimeConstant();
            if (timeConstant !== null) {
                this.params.timeConstant = timeConstant;
            }

            // Estimate solar gain from sunny periods
            const solarGain = await this._estimateSolarGain();
            if (solarGain !== null) {
                this.params.solarGainFactor = solarGain;
            }

            // Estimate heat loss from heating periods
            const heatLoss = await this._estimateHeatLoss();
            if (heatLoss !== null) {
                this.params.heatLossCoefficient = heatLoss;
            }

            this.params.lastCalibration = new Date().toISOString();

            // Save updated parameters
            await this._saveParams();

            // Notify predictive controller
            if (this.device.predictiveController) {
                this.device.predictiveController.updateBuildingParameters({
                    timeConstant: this.params.timeConstant,
                    solarGainFactor: this.params.solarGainFactor
                });
            }

            this.emit('success', `ThermalCalibrator: Calibration complete - tau=${this.params.timeConstant.toFixed(1)}h`);
        } catch (error) {
            this.emit('warn', `ThermalCalibrator: Calibration failed - ${error.message}`);
        }
    }

    /**
     * Estimate building time constant from HVAC-off periods
     * Uses exponential decay fitting: T(t) = T_outdoor + (T_start - T_outdoor) * e^(-t/tau)
     */
    async _estimateTimeConstant() {
        const periods = await this.influxClient.getHvacOffPeriods(this.deviceId, 4);

        if (periods.length === 0) {
            this.emit('debug', 'ThermalCalibrator: No HVAC-off periods found for time constant estimation');
            return null;
        }

        const tauEstimates = [];

        for (const period of periods) {
            if (period.length < 8) continue; // Need at least 2 hours of data

            const startTemp = period[0].temp;
            const avgOutdoor = period.reduce((sum, p) => sum + (p.outdoor || 0), 0) / period.length;

            // Skip if outdoor temp is similar to indoor (no decay to measure)
            if (Math.abs(startTemp - avgOutdoor) < 2) continue;

            // Fit exponential decay
            let sumLnRatio = 0;
            let count = 0;

            for (let i = 1; i < period.length; i++) {
                const t = i * 0.25; // hours (15 min intervals)
                const ratio = (period[i].temp - avgOutdoor) / (startTemp - avgOutdoor);

                if (ratio > 0.1 && ratio < 1) { // Valid range for fitting
                    sumLnRatio += -Math.log(ratio) / t;
                    count++;
                }
            }

            if (count > 0) {
                const avgDecayRate = sumLnRatio / count;
                const tau = 1 / avgDecayRate;

                // Sanity check: tau should be between 6 and 48 hours for a passive house
                if (tau >= 6 && tau <= 48) {
                    tauEstimates.push(tau);
                }
            }
        }

        if (tauEstimates.length === 0) {
            return null;
        }

        // Use median to avoid outliers
        tauEstimates.sort((a, b) => a - b);
        const median = tauEstimates[Math.floor(tauEstimates.length / 2)];

        this.params.dataPoints = tauEstimates.length;
        this.emit('debug', `ThermalCalibrator: Time constant estimate: ${median.toFixed(1)}h (from ${tauEstimates.length} periods)`);

        return median;
    }

    /**
     * Estimate solar gain factor from sunny HVAC-off periods
     */
    async _estimateSolarGain() {
        const data = await this.influxClient.getSunnyPeriods(this.deviceId, 200);

        if (data.length < 8) {
            this.emit('debug', 'ThermalCalibrator: Insufficient sunny data for solar gain estimation');
            return null;
        }

        // Calculate temperature rise per unit solar radiation
        const gains = [];

        for (let i = 1; i < data.length; i++) {
            const tempRise = data[i].temp - data[i - 1].temp;
            const avgSolar = (data[i].solar + data[i - 1].solar) / 2;

            if (avgSolar > 100 && tempRise > 0) {
                // °C per 15 min per W/m² -> °C per hour per W/m²
                gains.push((tempRise * 4) / avgSolar);
            }
        }

        if (gains.length === 0) {
            return null;
        }

        // Use median
        gains.sort((a, b) => a - b);
        const median = gains[Math.floor(gains.length / 2)];

        this.emit('debug', `ThermalCalibrator: Solar gain estimate: ${median.toFixed(4)} °C/h per W/m²`);

        return median;
    }

    /**
     * Estimate heat loss coefficient from heating periods
     */
    async _estimateHeatLoss() {
        const data = await this.influxClient.getHeatingPeriods(this.deviceId);

        if (data.length < 4) {
            this.emit('debug', 'ThermalCalibrator: Insufficient heating data for heat loss estimation');
            return null;
        }

        // Calculate heat loss as function of outdoor temp difference
        const losses = [];

        for (const point of data) {
            if (point.indoor && point.outdoor && point.setpoint) {
                const tempDiff = point.indoor - point.outdoor;
                const heatingEffort = point.setpoint - point.indoor;

                if (tempDiff > 5 && heatingEffort > 0) {
                    losses.push(heatingEffort / tempDiff);
                }
            }
        }

        if (losses.length === 0) {
            return null;
        }

        // Use median
        losses.sort((a, b) => a - b);
        const median = losses[Math.floor(losses.length / 2)];

        this.emit('debug', `ThermalCalibrator: Heat loss estimate: ${median.toFixed(3)}`);

        return median;
    }

    /**
     * Get current parameters
     */
    getParams() {
        return { ...this.params };
    }

    /**
     * Get validation metrics
     */
    getMetrics() {
        return {
            lastCalibration: this.params.lastCalibration,
            dataPoints: this.params.dataPoints,
            timeConstant: this.params.timeConstant,
            solarGainFactor: this.params.solarGainFactor,
            heatLossCoefficient: this.params.heatLossCoefficient
        };
    }

    /**
     * Stop the calibrator
     */
    stop() {
        if (this.calibrationTimeout) {
            clearTimeout(this.calibrationTimeout);
            this.calibrationTimeout = null;
        }
        if (this.calibrationInterval) {
            clearInterval(this.calibrationInterval);
            this.calibrationInterval = null;
        }
        this.emit('debug', 'ThermalCalibrator: Stopped');
    }
}

export { ThermalCalibrator };
export default ThermalCalibrator;
