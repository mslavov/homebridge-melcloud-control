import EventEmitter from 'events';
import { InfluxDB, FieldType } from 'influx';

/**
 * InfluxDB 1.8 client wrapper for thermal data logging
 * Follows the same EventEmitter pattern as other modules
 */
class InfluxClient extends EventEmitter {
    constructor(config) {
        super();

        this.config = {
            host: config.host || 'localhost',
            port: config.port || 8086,
            database: config.database || 'homebridge',
            username: config.username || '',
            password: config.password || '',
            retentionDays: config.retentionDays || 30
        };

        this.influx = null;
        this.isConnected = false;
        this.writeBuffer = [];
        this.flushInterval = null;
        this.flushIntervalMs = 60 * 1000; // Flush every 60 seconds
    }

    /**
     * Initialize InfluxDB connection
     */
    async init() {
        try {
            this.influx = new InfluxDB({
                host: this.config.host,
                port: this.config.port,
                database: this.config.database,
                username: this.config.username,
                password: this.config.password,
                schema: [
                    {
                        measurement: 'thermal_data',
                        fields: {
                            indoor_temp: FieldType.FLOAT,
                            recuperator_temp: FieldType.FLOAT,
                            outdoor_temp: FieldType.FLOAT,
                            ac_setpoint: FieldType.FLOAT,
                            user_target: FieldType.FLOAT,
                            predicted_temp: FieldType.FLOAT,
                            solar_radiation: FieldType.FLOAT,
                            power_state: FieldType.BOOLEAN
                        },
                        tags: ['device_id', 'hvac_state', 'season_mode']
                    }
                ]
            });

            // Check if database exists, create if not
            const databases = await this.influx.getDatabaseNames();
            if (!databases.includes(this.config.database)) {
                await this.influx.createDatabase(this.config.database);
                this.emit('info', `Created InfluxDB database: ${this.config.database}`);
            }

            // Create retention policy if it doesn't exist
            await this._ensureRetentionPolicy();

            // Start flush interval
            this.flushInterval = setInterval(() => this._flushBuffer(), this.flushIntervalMs);

            this.isConnected = true;
            this.emit('success', `InfluxDB connected to ${this.config.host}:${this.config.port}/${this.config.database}`);

            return true;
        } catch (error) {
            this.isConnected = false;
            this.emit('warn', `InfluxDB connection failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Ensure retention policy exists
     */
    async _ensureRetentionPolicy() {
        try {
            const rpName = 'thermal_retention';
            const duration = `${this.config.retentionDays}d`;

            // Check existing retention policies
            const policies = await this.influx.showRetentionPolicies(this.config.database);
            const exists = policies.some(p => p.name === rpName);

            if (!exists) {
                await this.influx.createRetentionPolicy(rpName, {
                    database: this.config.database,
                    duration,
                    replication: 1,
                    isDefault: false
                });
                this.emit('debug', `Created retention policy: ${rpName} (${duration})`);
            }
        } catch (error) {
            this.emit('warn', `Failed to create retention policy: ${error.message}`);
        }
    }

    /**
     * Write a thermal data point
     * @param {Object} data - Data to write
     */
    writePoint(data) {
        if (!this.isConnected) {
            return;
        }

        const point = {
            measurement: 'thermal_data',
            tags: {
                device_id: data.deviceId || 'unknown',
                hvac_state: data.hvacState || 'unknown',
                season_mode: data.seasonMode || 'unknown'
            },
            fields: {},
            timestamp: data.timestamp || new Date()
        };

        // Add fields only if they have valid values
        if (typeof data.indoorTemp === 'number') {
            point.fields.indoor_temp = data.indoorTemp;
        }
        if (typeof data.recuperatorTemp === 'number') {
            point.fields.recuperator_temp = data.recuperatorTemp;
        }
        if (typeof data.outdoorTemp === 'number') {
            point.fields.outdoor_temp = data.outdoorTemp;
        }
        if (typeof data.acSetpoint === 'number') {
            point.fields.ac_setpoint = data.acSetpoint;
        }
        if (typeof data.userTarget === 'number') {
            point.fields.user_target = data.userTarget;
        }
        if (typeof data.predictedTemp === 'number') {
            point.fields.predicted_temp = data.predictedTemp;
        }
        if (typeof data.solarRadiation === 'number') {
            point.fields.solar_radiation = data.solarRadiation;
        }
        if (typeof data.powerState === 'boolean') {
            point.fields.power_state = data.powerState;
        }

        // Only add to buffer if we have at least one field
        if (Object.keys(point.fields).length > 0) {
            this.writeBuffer.push(point);
        }
    }

    /**
     * Flush write buffer to InfluxDB
     */
    async _flushBuffer() {
        if (!this.isConnected || this.writeBuffer.length === 0) {
            return;
        }

        const points = [...this.writeBuffer];
        this.writeBuffer = [];

        try {
            await this.influx.writePoints(points);
            this.emit('debug', `Flushed ${points.length} points to InfluxDB`);
        } catch (error) {
            // Put points back in buffer on failure
            this.writeBuffer = [...points, ...this.writeBuffer];
            this.emit('warn', `Failed to write to InfluxDB: ${error.message}`);
        }
    }

    /**
     * Query HVAC-off periods for thermal calibration
     * @param {string} deviceId - Device identifier
     * @param {number} minHours - Minimum hours for a valid period
     * @returns {Promise<Array>} Array of HVAC-off periods with temperature data
     */
    async getHvacOffPeriods(deviceId, minHours = 4) {
        if (!this.isConnected) {
            return [];
        }

        try {
            const query = `
                SELECT mean(indoor_temp) as temp, mean(outdoor_temp) as outdoor
                FROM thermal_data
                WHERE device_id = '${deviceId}'
                AND hvac_state = 'STANDBY'
                AND time > now() - 7d
                GROUP BY time(15m)
                ORDER BY time ASC
            `;

            const results = await this.influx.query(query);

            // Process results to find continuous off periods
            return this._findContinuousPeriods(results, minHours * 4); // 4 points per hour
        } catch (error) {
            this.emit('warn', `Failed to query HVAC-off periods: ${error.message}`);
            return [];
        }
    }

    /**
     * Query sunny periods for solar gain analysis
     * @param {string} deviceId - Device identifier
     * @param {number} minRadiation - Minimum solar radiation W/m²
     * @returns {Promise<Array>} Array of sunny periods with temperature/radiation data
     */
    async getSunnyPeriods(deviceId, minRadiation = 200) {
        if (!this.isConnected) {
            return [];
        }

        try {
            const query = `
                SELECT mean(indoor_temp) as temp, mean(solar_radiation) as solar
                FROM thermal_data
                WHERE device_id = '${deviceId}'
                AND hvac_state = 'STANDBY'
                AND solar_radiation > ${minRadiation}
                AND time > now() - 7d
                GROUP BY time(15m)
                ORDER BY time ASC
            `;

            const results = await this.influx.query(query);
            return results;
        } catch (error) {
            this.emit('warn', `Failed to query sunny periods: ${error.message}`);
            return [];
        }
    }

    /**
     * Query heating periods for heat loss analysis
     * @param {string} deviceId - Device identifier
     * @returns {Promise<Array>} Array of heating periods with temperature data
     */
    async getHeatingPeriods(deviceId) {
        if (!this.isConnected) {
            return [];
        }

        try {
            const query = `
                SELECT mean(indoor_temp) as indoor, mean(outdoor_temp) as outdoor,
                       mean(ac_setpoint) as setpoint
                FROM thermal_data
                WHERE device_id = '${deviceId}'
                AND (hvac_state = 'HEATING_ACTIVE' OR hvac_state = 'PRE_HEAT')
                AND time > now() - 7d
                GROUP BY time(15m)
                ORDER BY time ASC
            `;

            const results = await this.influx.query(query);
            return results;
        } catch (error) {
            this.emit('warn', `Failed to query heating periods: ${error.message}`);
            return [];
        }
    }

    /**
     * Find continuous periods in data
     */
    _findContinuousPeriods(data, minPoints) {
        const periods = [];
        let currentPeriod = [];

        for (let i = 0; i < data.length; i++) {
            const point = data[i];

            if (point.temp !== null) {
                currentPeriod.push(point);
            } else if (currentPeriod.length >= minPoints) {
                periods.push([...currentPeriod]);
                currentPeriod = [];
            } else {
                currentPeriod = [];
            }
        }

        // Check last period
        if (currentPeriod.length >= minPoints) {
            periods.push(currentPeriod);
        }

        return periods;
    }

    /**
     * Get connection status
     */
    getIsConnected() {
        return this.isConnected;
    }

    /**
     * Stop the client
     */
    async stop() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Final flush
        await this._flushBuffer();

        this.isConnected = false;
        this.emit('debug', 'InfluxDB client stopped');
    }
}

export { InfluxClient };
export default InfluxClient;
