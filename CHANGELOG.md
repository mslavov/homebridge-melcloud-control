# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - (04.01.2026)

### Added

- **Comprehensive Documentation**: New `docs/` folder with detailed guides
  - [Terminology](docs/terminology.md) - Glossary of temperature terms and concepts
  - [Architecture](docs/architecture.md) - System overview and component diagram
  - [Predictive Control](docs/predictive-control.md) - The 4-layer algorithm explained
  - [State Machine](docs/state-machine.md) - 8 HVAC states and transitions
  - [Configuration](docs/configuration.md) - Complete configuration reference

### Fixed

- **Critical: Setpoint not applied to AC** - State machine now reapplies setpoint when staying in same state
- **Initialization bug** - User target temperature now initialized from config (not stale AC value)
- **HomeKit threshold warnings** - Reduced comfort band to stay within HomeKit's valid range (20-30°C)
- **Minimum heating setpoint** - Algorithm now clamps to max 2°C below user target to prevent under-heating

### Changed

- Improved logging for prediction calculations and state machine decisions
- ActionExecutor now logs setpoint changes with before/after values

## [1.1.0] - (01.01.2026)

### Added

- **Autonomous AC Control**: The predictive control system now automatically executes actions via MELCloud API
  - State machine transitions (HEATING_ACTIVE, COOLING_ACTIVE, etc.) now trigger actual AC commands
  - New ActionExecutor module translates state machine decisions to API calls
  - Rate limiting (60s minimum between autonomous commands) prevents API spam
  - Combined API flags for efficient power + mode + setpoint updates

### Fixed

- State machine computed actions but never executed them (predictive control was informational only)

## [1.0.0] - (31.12.2024)

### Initial Release

This is a new Homebridge plugin designed specifically for passive house climate control using Mitsubishi AC via MELCloud.

### Features

- **Predictive Climate Control**: Weather-based setpoint calculation using Open-Meteo API forecasts
- **State Machine**: 8-state HVAC control with anti-oscillation protection (STANDBY, PRE_HEAT, PRE_COOL, HEATING_ACTIVE, COOLING_ACTIVE, HEATING_COAST, COOLING_COAST, SENSOR_FAULT)
- **External Temperature Sensor**: Required Shelly sensor integration for accurate room temperature measurement
- **Temperature Compensation**: Automatic offset calculation between AC sensor and external sensor
- **Thermal Learning** (optional): InfluxDB 1.8 integration for logging thermal data and calibrating building parameters
- **Thermal Calibration**: Automatic learning of building time constant, solar gain factor, and heat loss coefficient
- **Comfort Band**: ±3°C adjustment range around target temperature
- **Season Detection**: Heat/Cool mode selection determines winter/summer behavior

### Requirements

- External temperature sensor (Shelly Cloud)
- Location coordinates (latitude/longitude) for weather forecasts
- Optional: InfluxDB 1.8 for thermal data logging and learning

### Credits

Based on the original [homebridge-melcloud-control](https://github.com/grzegorz914/homebridge-melcloud-control) by grzegorz914.
