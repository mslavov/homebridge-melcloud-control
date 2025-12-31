import EventEmitter from 'events';
import { OpenMeteo } from './constants.js';

/**
 * Open-Meteo weather API client with caching
 * Follows the ShellyCloud pattern for consistency
 */
class WeatherClient extends EventEmitter {
    constructor(device) {
        super();
        this.device = device;
        this.latitude = device.location?.latitude;
        this.longitude = device.location?.longitude;

        // Cached forecast data
        this.forecast = null;
        this.lastFetchTime = null;
        this.isAvailable = false;

        // Polling
        this.pollingInterval = null;
    }

    /**
     * Initialize the weather client and start polling
     */
    async init() {
        if (!this.latitude || !this.longitude) {
            this.emit('warn', 'Weather client: Location not configured, cannot fetch forecast');
            return false;
        }

        this.emit('debug', `Weather client: Initializing for location ${this.latitude}, ${this.longitude}`);

        // Initial fetch
        try {
            await this.fetchForecast();
            this.isAvailable = true;
            this.emit('success', `Weather client: Connected, polling every ${OpenMeteo.CACHE_HOURS} hours`);
        } catch (error) {
            this.emit('warn', `Weather client: Initial fetch failed - ${error.message}`);
        }

        // Start polling
        this.pollingInterval = setInterval(async () => {
            await this.fetchForecast();
        }, OpenMeteo.POLL_INTERVAL);

        return true;
    }

    /**
     * Stop polling
     */
    stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Fetch 24-hour forecast from Open-Meteo
     */
    async fetchForecast() {
        const url = this._buildUrl();
        this.emit('debug', `Weather client: Fetching forecast from ${url}`);

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), OpenMeteo.REQUEST_TIMEOUT);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.forecast = this._parseResponse(data);
            this.lastFetchTime = new Date();
            this.isAvailable = true;

            this.emit('forecast', this.forecast);
            this.emit('debug', `Weather client: Forecast updated, ${this.forecast.hourly.length} hours`);

            return this.forecast;
        } catch (error) {
            this.isAvailable = false;
            this.emit('warn', `Weather client: Fetch failed - ${error.message}`);

            // If we have cached data, use it
            if (this.forecast) {
                this.emit('debug', 'Weather client: Using cached forecast');
                return this.forecast;
            }

            this.emit('unavailable', error);
            return null;
        }
    }

    /**
     * Build Open-Meteo API URL
     */
    _buildUrl() {
        return `${OpenMeteo.BASE_URL}?latitude=${this.latitude}&longitude=${this.longitude}&hourly=${OpenMeteo.HOURLY_PARAMS}&forecast_days=${OpenMeteo.FORECAST_DAYS}`;
    }

    /**
     * Parse Open-Meteo API response into structured forecast data
     */
    _parseResponse(data) {
        const hourly = data.hourly;
        const times = hourly.time || [];

        const forecast = {
            fetchTime: new Date(),
            location: {
                latitude: data.latitude,
                longitude: data.longitude,
                elevation: data.elevation
            },
            hourly: []
        };

        for (let i = 0; i < times.length && i < 48; i++) {
            forecast.hourly.push({
                time: new Date(times[i]),
                temperature: hourly.temperature_2m?.[i] ?? null,
                solarRadiation: hourly.shortwave_radiation?.[i] ?? 0,
                directRadiation: hourly.direct_radiation?.[i] ?? 0,
                cloudCover: hourly.cloud_cover?.[i] ?? 0,
                windSpeed: hourly.wind_speed_10m?.[i] ?? 0
            });
        }

        return forecast;
    }

    /**
     * Get current outdoor temperature from forecast
     */
    getCurrentOutdoorTemp() {
        if (!this.forecast || !this.forecast.hourly.length) {
            return null;
        }
        return this.forecast.hourly[0].temperature;
    }

    /**
     * Get current solar radiation
     */
    getCurrentSolarRadiation() {
        if (!this.forecast || !this.forecast.hourly.length) {
            return 0;
        }
        return this.forecast.hourly[0].solarRadiation;
    }

    /**
     * Get forecast temperatures for next N hours
     */
    getForecastTemperatures(hours = 24) {
        if (!this.forecast || !this.forecast.hourly.length) {
            return [];
        }
        return this.forecast.hourly
            .slice(0, hours)
            .map(h => h.temperature)
            .filter(t => t !== null);
    }

    /**
     * Get forecast solar radiation for next N hours
     */
    getForecastSolarRadiation(hours = 24) {
        if (!this.forecast || !this.forecast.hourly.length) {
            return [];
        }
        return this.forecast.hourly
            .slice(0, hours)
            .map(h => h.solarRadiation);
    }

    /**
     * Get average forecast temperature for next N hours
     */
    getAverageForecastTemp(hours = 24) {
        const temps = this.getForecastTemperatures(hours);
        if (!temps.length) return null;
        return temps.reduce((a, b) => a + b, 0) / temps.length;
    }

    /**
     * Get minimum forecast temperature in next N hours
     */
    getMinForecastTemp(hours = 24) {
        const temps = this.getForecastTemperatures(hours);
        if (!temps.length) return null;
        return Math.min(...temps);
    }

    /**
     * Get maximum forecast temperature in next N hours
     */
    getMaxForecastTemp(hours = 24) {
        const temps = this.getForecastTemperatures(hours);
        if (!temps.length) return null;
        return Math.max(...temps);
    }

    /**
     * Check if cache is still valid
     */
    isCacheValid() {
        if (!this.lastFetchTime) return false;
        const ageHours = (Date.now() - this.lastFetchTime.getTime()) / (1000 * 60 * 60);
        return ageHours < OpenMeteo.CACHE_HOURS;
    }

    /**
     * Get the full forecast object
     */
    getForecast() {
        return this.forecast;
    }

    /**
     * Check if weather data is available
     */
    getIsAvailable() {
        return this.isAvailable && this.isCacheValid();
    }
}

export { WeatherClient };
export default WeatherClient;
