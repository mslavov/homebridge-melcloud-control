# MELCloud Passive House

Homebridge plugin for **passive house climate control** using Mitsubishi AC via MELCloud.

## Why Passive Houses Need Different Climate Control

Passive houses have exceptional thermal mass and insulation, meaning:
- **Slow temperature changes**: A well-insulated home takes 12-24 hours to lose 1°C
- **Solar gain matters**: South-facing windows can heat a room by 3-4°C on a sunny winter day
- **Anticipation beats reaction**: By the time you feel cold, it's too late to heat efficiently

This plugin uses **predictive control** - it looks at weather forecasts and starts heating/cooling *before* you need it, keeping your home comfortable while minimizing energy use.

## Features

- **Predictive Temperature Control**: Uses Open-Meteo weather forecasts to anticipate heating/cooling needs
- **External Temperature Sensor**: Uses Shelly sensor for accurate room temperature (AC sensors are typically 2-3°C off)
- **State Machine Control**: 8-state HVAC management with anti-oscillation protection
- **Thermal Learning** (optional): InfluxDB logging to learn your building's thermal characteristics
- **Comfort Band**: Set a target temperature with ±3°C adjustment range in HomeKit

## Requirements

| Requirement | Description |
|-------------|-------------|
| **Homebridge** | v2.0.0 or later |
| **Mitsubishi AC** | Connected to MELCloud |
| **Shelly Sensor** | External temperature sensor (Shelly H&T, Plus H&T, etc.) |
| **Location** | Latitude/longitude for weather forecasts |
| **InfluxDB** (optional) | v1.8 for thermal data logging |

## Installation

```bash
npm install -g homebridge-melcloud-passive-house
```

Or search for "MELCloud Passive House" in the Homebridge UI plugins tab.

## Configuration

### Basic Setup

```json
{
  "platforms": [
    {
      "platform": "melcloudpassivehouse",
      "accounts": [
        {
          "name": "Home",
          "user": "your@email.com",
          "passwd": "your-password",
          "language": "0",
          "type": "melcloud",
          "ataDevices": [
            {
              "id": "123456",
              "displayType": 1,
              "name": "Living Room AC",
              "targetTemperature": 23,
              "location": {
                "latitude": 42.6977,
                "longitude": 23.3219
              },
              "externalSensor": {
                "type": "shelly",
                "shellyServerUri": "shelly-XX-eu.shelly.cloud",
                "shellyAuthKey": "your-auth-key",
                "shellyDeviceId": "your-device-id"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `targetTemperature` | No | 23 | Target comfort temperature (°C) |
| `location.latitude` | Yes | - | Location latitude for weather |
| `location.longitude` | Yes | - | Location longitude for weather |
| `externalSensor.shellyServerUri` | Yes | - | Shelly Cloud server (from app settings) |
| `externalSensor.shellyAuthKey` | Yes | - | Shelly Cloud API key |
| `externalSensor.shellyDeviceId` | Yes | - | Shelly device ID |
| `externalSensor.pollInterval` | No | 60 | Sensor poll interval (seconds) |

### Optional: InfluxDB Logging

Add thermal data logging for analysis and automatic calibration:

```json
"influxDb": {
  "enabled": true,
  "host": "localhost",
  "port": 8086,
  "database": "homebridge",
  "username": "",
  "password": "",
  "retentionDays": 30
}
```

## How It Works

### Temperature Flow

```
External Sensor (Shelly) → Actual Room Temperature
         ↓
Weather Forecast (Open-Meteo) → Predicted Conditions
         ↓
Predictive Controller → Calculate Optimal Setpoint
         ↓
Temperature Compensation → Adjust for AC Sensor Offset
         ↓
MELCloud API → Set AC Temperature
```

### State Machine

The plugin maintains one of 8 states:

| State | Description |
|-------|-------------|
| `STANDBY` | AC off, temperature within comfort band |
| `PRE_HEAT` | Anticipatory heating (cold weather coming) |
| `PRE_COOL` | Anticipatory cooling (hot weather coming) |
| `HEATING_ACTIVE` | Actively heating |
| `COOLING_ACTIVE` | Actively cooling |
| `HEATING_COAST` | Near target, coasting to avoid overshoot |
| `COOLING_COAST` | Near target, coasting to avoid overshoot |
| `SENSOR_FAULT` | External sensor unavailable |

### Autonomous Control

The plugin automatically controls the AC based on state machine decisions:
- **HEATING_ACTIVE/PRE_HEAT**: Powers on, sets heat mode, adjusts setpoint
- **COOLING_ACTIVE/PRE_COOL**: Powers on, sets cool mode, adjusts setpoint
- **COAST states**: Adjusts setpoint while maintaining current mode
- **STANDBY**: No action (AC remains in current state)

Rate limiting ensures commands are sent no more than once per minute.

### Anti-Oscillation Protection

- **Deadband**: 4°C total width prevents rapid switching
- **Minimum on-time**: 5 minutes before AC can turn off
- **Minimum off-time**: 3 minutes before AC can turn on
- **Mode switch delay**: 10 minutes between heating↔cooling

### Season Mode

The Heat/Cool selector in HomeKit determines behavior:
- **Heat mode**: Winter behavior - anticipate cold snaps, accept solar gain
- **Cool mode**: Summer behavior - pre-cool overnight, protect from heatwaves
- **Auto mode**: System decides based on forecast

## Finding Your Shelly Configuration

1. Open the Shelly app
2. Go to **User Settings** → **Cloud API**
3. Note the **Server URI** (e.g., `shelly-58-eu.shelly.cloud`)
4. Generate an **Auth Key**
5. Go to your device → **Settings** → **Device Information**
6. Note the **Device ID**

## Thermal Learning (Optional)

When InfluxDB is enabled, the plugin:
1. Logs temperature data every 5 minutes
2. Runs daily calibration at 3 AM
3. Learns your building's:
   - **Time constant (τ)**: How fast your home loses heat (typically 12-24h for passive houses)
   - **Solar gain factor**: How much sun heats your home
   - **Heat loss coefficient**: Relationship between outdoor temp and heat loss

Estimated storage: ~100 MB per device with 30-day retention.

## Credits

Based on [homebridge-melcloud-control](https://github.com/grzegorz914/homebridge-melcloud-control) by grzegorz914.

## License

MIT
