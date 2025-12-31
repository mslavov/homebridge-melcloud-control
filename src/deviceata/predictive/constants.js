/**
 * Constants for predictive passive house control
 */

// AC control state machine states
export const States = {
    STANDBY: 'STANDBY',                   // AC off, temp in deadband
    PRE_HEAT: 'PRE_HEAT',                 // Anticipatory heating (forecast-triggered)
    PRE_COOL: 'PRE_COOL',                 // Anticipatory cooling (forecast-triggered)
    HEATING_ACTIVE: 'HEATING_ACTIVE',     // AC actively heating
    COOLING_ACTIVE: 'COOLING_ACTIVE',     // AC actively cooling
    HEATING_COAST: 'HEATING_COAST',       // Near target, coasting after heating
    COOLING_COAST: 'COOLING_COAST',       // Near target, coasting after cooling
    SENSOR_FAULT: 'SENSOR_FAULT'          // No sensor data
};

// Season modes derived from HomeKit HeaterCooler state
export const SeasonMode = {
    WINTER: 'winter',   // Heat mode - heating-focused prediction
    SUMMER: 'summer'    // Cool mode - cooling-focused prediction
};

// Anti-oscillation parameters
export const AntiOscillation = {
    DEADBAND: 4.0,              // °C total deadband width
    HYSTERESIS: 2.0,            // °C before switching modes
    MIN_ON_TIME: 5 * 60,        // 5 minutes minimum runtime once activated (seconds)
    MIN_OFF_TIME: 3 * 60,       // 3 minutes minimum off before restart (seconds)
    MIN_MODE_SWITCH: 10 * 60,   // 10 minutes between heat↔cool transitions (seconds)
    COASTING_OVERSHOOT: 0.5     // °C expected overshoot when coasting
};

// Predictive algorithm parameters
export const PredictiveDefaults = {
    COMFORT_BAND: 3,                    // ±3°C from target temperature
    DEFAULT_TARGET_TEMP: 23,            // Default target temperature in °C
    BUILDING_TIME_CONSTANT: 18,         // Default tau in hours (passive house)
    OUTDOOR_RESET_SLOPE: 0.4,           // Outdoor reset curve slope
    SOLAR_GAIN_FACTOR: 0.15,            // °C rise per 100 W/m² solar radiation
    FORECAST_HORIZON: 24,               // Hours to look ahead
    DECAY_CONSTANT: 6,                  // Hours for exponential decay weighting
    COLD_SNAP_THRESHOLD: 5,             // °C drop to trigger PRE_HEAT
    HEATWAVE_THRESHOLD: 30,             // °C outdoor temp for heatwave mode
    SOLAR_REDUCTION_THRESHOLD: 200,     // W/m² to start reducing heating setpoint
    NIGHT_COOLING_START_HOUR: 22,       // 10 PM
    NIGHT_COOLING_END_HOUR: 8,          // 8 AM
    PRE_COOL_START_HOUR: 4,             // 4 AM optimal pre-cooling start
    PRE_COOL_END_HOUR: 8                // 8 AM end pre-cooling
};

// Open-Meteo API configuration
export const OpenMeteo = {
    BASE_URL: 'https://api.open-meteo.com/v1/forecast',
    HOURLY_PARAMS: 'temperature_2m,shortwave_radiation,direct_radiation,cloud_cover,wind_speed_10m',
    FORECAST_DAYS: 2,
    CACHE_HOURS: 2,                     // Cache forecast for 2 hours
    POLL_INTERVAL: 60 * 60 * 1000,      // Poll every 60 minutes (ms)
    REQUEST_TIMEOUT: 10000              // 10 second timeout
};

// HomeKit HeaterCooler state values
export const HeaterCoolerState = {
    AUTO: 0,
    HEAT: 1,
    COOL: 2
};

// Logging intervals
export const LoggingIntervals = {
    THERMAL_LOG_INTERVAL: 5 * 60 * 1000,    // 5 minutes
    CALIBRATION_HOUR: 3                      // Run calibration at 3 AM
};

export default {
    States,
    SeasonMode,
    AntiOscillation,
    PredictiveDefaults,
    OpenMeteo,
    HeaterCoolerState,
    LoggingIntervals
};
