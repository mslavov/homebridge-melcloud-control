# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
