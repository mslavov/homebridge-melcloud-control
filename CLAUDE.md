# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Homebridge plugin (`homebridge-melcloud-passive-house`) for **passive house climate control** using Mitsubishi Air Conditioner (ATA) devices via MELCloud REST API. The plugin features:

- **Predictive temperature control** using weather forecasts (Open-Meteo API)
- **External temperature sensors** (Shelly) for accurate room temperature
- **State machine control** with anti-oscillation protection
- **Thermal learning** (optional) via InfluxDB for building parameter calibration

## Development Commands

No build step is required - this is a pure ES Modules JavaScript project that runs directly on Node.js.

**Run locally with Homebridge:**
```bash
homebridge -D -P /path/to/homebridge-melcloud-passive-house
```

**Run tests:**
```bash
npm test
```

**Publish to npm:**
```bash
npm publish
```

## Releasing New Versions

When bumping versions, update both files:

1. **`package.json`** - Update the `version` field
2. **`CHANGELOG.md`** - Add a new entry at the top following this format:

```markdown
## [X.Y.Z] - (DD.MM.YYYY)

### Changes

- Description of changes
- Additional changes
```

## Architecture

### Entry Point
- `index.js` - Registers the platform plugin with Homebridge, handles account configuration, and instantiates device handlers

### Core Source Files (`src/`)

**Cloud Service Clients:**
- `melcloud.js` - MELCloud REST API client with polling-based state updates
- `shellycloud.js` - Shelly Cloud API client for external temperature sensors

**Device Handler:**
- `melcloudata.js` - ATA device state management and API calls

**Supporting Modules:**
- `constants.js` - Platform name, API URLs, device type enums, operation mode mappings
- `functions.js` - Utility functions for file I/O and data handling
- `impulsegenerator.js` - Timer-based polling mechanism using EventEmitter

### DeviceAta Module (`src/deviceata/`)

The main device handler with predictive control:

```
src/deviceata/
├── index.js              # Main DeviceAta class, orchestrates all sub-modules
├── external-sensor.js    # Shelly sensor integration & temperature compensation
├── state-parser.js       # Parses MELCloud state → HomeKit accessory state
├── state-updater.js      # Updates HomeKit services from parsed state
├── services/
│   ├── index.js          # ServiceFactory - creates HomeKit services
│   └── heater-cooler.js  # HeaterCooler service (main AC control)
├── predictive/           # Predictive climate control
│   ├── index.js          # PredictiveController orchestrator
│   ├── weather-client.js # Open-Meteo API with caching
│   ├── setpoint-calculator.js  # Predictive algorithm
│   ├── state-machine.js  # 8-state HVAC control
│   └── constants.js      # States, thresholds, defaults
└── thermal/              # Optional thermal learning (InfluxDB)
    ├── index.js          # ThermalManager orchestrator
    ├── influx-client.js  # InfluxDB 1.8 client wrapper
    └── thermal-calibrator.js  # Building parameter learning
```

### Predictive Control Flow

```
1. WeatherClient fetches 48h forecast from Open-Meteo
2. SetpointCalculator computes optimal setpoint based on:
   - Current indoor/outdoor temps
   - Forecast temperatures
   - Solar radiation
   - Building time constant
3. StateMachine determines HVAC state (8 states)
4. ExternalSensor applies temperature compensation
5. MELCloud API receives adjusted setpoint
```

### State Machine States

| State | Description |
|-------|-------------|
| `STANDBY` | AC off, temperature within deadband |
| `PRE_HEAT` | Anticipatory heating (cold weather coming) |
| `PRE_COOL` | Anticipatory cooling (hot weather coming) |
| `HEATING_ACTIVE` | Actively heating |
| `COOLING_ACTIVE` | Actively cooling |
| `HEATING_COAST` | Near target, coasting |
| `COOLING_COAST` | Near target, coasting |
| `SENSOR_FAULT` | External sensor unavailable |

### Custom UI (`homebridge-ui/`)
- `server.js` - Backend for Homebridge Config UI X custom plugin interface
- `public/index.html` - Frontend for device discovery and configuration

### Test Suite (`test/`)

Uses Node.js built-in test runner (requires Node 20+):

```
test/
├── state-parser.test.js           # Unit tests for state parsing
├── deviceata-comparison.test.js   # Integration tests for DeviceAta
├── predictive.test.js             # Tests for SetpointCalculator & StateMachine
├── thermal.test.js                # Tests for ThermalCalibrator & ThermalManager
├── mocks/
│   ├── homebridge-api.js          # Mock Homebridge API
│   └── melcloudata-mock.js        # Mock MelCloudAta client
└── fixtures/
    └── device-data.js             # Sample MELCloud device data
```

### Key Patterns

**Event-driven architecture:** All major classes extend `EventEmitter` and communicate via events (`success`, `info`, `warn`, `error`, `debug`).

**Predictive control:** Weather forecasts drive setpoint calculation. The algorithm considers outdoor temperature trends, solar radiation, and building thermal mass.

**Anti-oscillation:** State machine enforces minimum on/off times (5min on, 3min off) and mode switch delays (10min between heat↔cool).

**External sensor compensation:**
1. Polls Shelly sensor for actual room temperature
2. Calculates offset: `offset = AC_sensor - external_sensor`
3. Compensates setpoint: `actual_setpoint = target + offset`

**Thermal learning (optional):**
- InfluxDB logs temperature data every 5 minutes
- Daily calibration at 3 AM learns building parameters
- Parameters stored in `{storagePath}/melcloud/{deviceId}_thermal_params.json`

## Configuration

Configuration is managed through `config.schema.json` for Homebridge Config UI X. Key config structure:
- `accounts[]` - Array of MELCloud accounts
  - `ataDevices[]` - Air Conditioner devices with:
    - `targetTemperature` - Comfort target (default 23°C)
    - `location` - Lat/lon for weather forecasts (required)
    - `externalSensor` - Shelly configuration (required)
    - `influxDb` - InfluxDB configuration (optional)
