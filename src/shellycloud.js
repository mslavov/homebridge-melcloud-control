import EventEmitter from 'events';

class ShellyCloud extends EventEmitter {
    constructor(config) {
        super();

        this.serverUri = config.shellyServerUri;
        this.authKey = config.shellyAuthKey;
        this.deviceId = config.shellyDeviceId;
        this.logDebug = config.logDebug;
        this.logWarn = config.logWarn;

        // State
        this.temperature = null;
        this.humidity = null;
        this.lastUpdate = null;
        this.isAvailable = false;

        // Rate limiting (Shelly Cloud allows 1 req/sec)
        this.minRequestInterval = 1000;
        this.lastRequestTime = 0;
    }

    async fetchTemperature() {
        try {
            // Rate limiting
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.minRequestInterval) {
                await new Promise(r => setTimeout(r, this.minRequestInterval - timeSinceLastRequest));
            }
            this.lastRequestTime = Date.now();

            const url = `https://${this.serverUri}/device/status`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `id=${this.deviceId}&auth_key=${this.authKey}`
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.isok) {
                throw new Error(data.errors?.join(', ') || 'Shelly API error');
            }

            // Parse temperature from H&T Gen3 response
            const deviceStatus = data.data?.device_status;
            if (deviceStatus) {
                // Gen3 format: temperature:0.tC
                const tempComponent = deviceStatus['temperature:0'];
                const humidityComponent = deviceStatus['humidity:0'];

                if (tempComponent?.tC !== undefined) {
                    this.temperature = tempComponent.tC;
                    this.humidity = humidityComponent?.rh ?? null;
                    this.lastUpdate = new Date();
                    this.isAvailable = true;

                    if (this.logDebug) {
                        this.emit('debug', `Shelly temperature: ${this.temperature}°C, humidity: ${this.humidity}%`);
                    }

                    this.emit('temperature', this.temperature, this.humidity);
                    return { temperature: this.temperature, humidity: this.humidity };
                }
            }

            throw new Error('Temperature data not found in response');
        } catch (error) {
            this.isAvailable = false;
            if (this.logWarn) {
                this.emit('warn', `Shelly Cloud error: ${error.message}`);
            }
            this.emit('unavailable', error);
            return null;
        }
    }

    getTemperature() {
        return this.temperature;
    }

    getHumidity() {
        return this.humidity;
    }

    isOnline() {
        return this.isAvailable;
    }

    getLastUpdate() {
        return this.lastUpdate;
    }
}

export default ShellyCloud;
