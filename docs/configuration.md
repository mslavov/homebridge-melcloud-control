# Configuration Reference

This document describes all configuration options for the homebridge-melcloud-passive-house plugin. Configuration is managed through `config.schema.json` for Homebridge Config UI X.

## Configuration Structure

```json
{
  "platform": "melcloudpassivehouse",
  "accounts": [
    {
      "name": "My Home",
      "user": "email@example.com",
      "passwd": "password",
      "language": "0",
      "type": "melcloud",
      "refreshInterval": 120,
      "log": { ... },
      "ataDevices": [
        {
          "id": "device-id",
          "displayType": 1,
          "name": "Living Room AC",
          "targetTemperature": 23,
          "location": { ... },
          "externalSensor": { ... },
          "influxDb": { ... }
        }
      ]
    }
  ]
}
```

## Account Settings

### `name` (required)
**Type**: `string`

Your own name for this account, displayed in HomeKit.

**Example**: `"My Home"`

---

### `user` (required)
**Type**: `string`

Your MELCloud account email address.

**Example**: `"your.email@example.com"`

---

### `passwd` (required)
**Type**: `string`

Your MELCloud account password.

---

### `language` (required)
**Type**: `string` (enum)
**Default**: `"0"` (English)

MELCloud account language setting. Common values:
- `"0"` - English
- `"1"` - Bulgarian
- `"4"` - German
- `"7"` - French
- `"19"` - Italian

---

### `type` (required)
**Type**: `string` (enum)
**Default**: `"disabled"`

Account type:
- `"melcloud"` - MELCloud account (active)
- `"disabled"` - Account disabled

---

### `refreshInterval`
**Type**: `integer`
**Default**: `120`
**Range**: `1` - `600` seconds

How often to poll MELCloud for device status updates.

**Recommendation**: 60-120 seconds for predictive control. Shorter intervals provide more responsive control but increase API calls.

---

### `log`
**Type**: `object`

Logging configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deviceInfo` | boolean | `true` | Log device info on plugin start |
| `success` | boolean | `true` | Log successful operations |
| `info` | boolean | `false` | Log informational messages (enable for observability) |
| `warn` | boolean | `true` | Log warnings |
| `error` | boolean | `true` | Log errors |
| `debug` | boolean | `false` | Log debug messages (verbose) |

**Recommendation for debugging**: Enable `info` to see prediction calculations and state machine decisions.

---

## ATA Device Settings

Each ATA (Air-To-Air) device has the following options:

### `id`
**Type**: `string`
**Read-only**

Device ID from MELCloud. Automatically populated by device discovery.

---

### `displayType` (required)
**Type**: `integer` (enum)
**Default**: `0`

HomeKit accessory type:
- `0` - None / Disabled (device not exposed to HomeKit)
- `1` - Heater / Cooler (recommended)

---

### `name`
**Type**: `string`
**Default**: `"Air Conditioner"`

Device name displayed in HomeKit.

**Example**: `"Living Room AC"`, `"Bedroom Climate"`

---

### `targetTemperature`
**Type**: `number`
**Default**: `23`
**Range**: `18` - `28` °C

The base target temperature (comfort midpoint). HomeKit displays a comfort band of ±2°C around this value.

**How it works**:
- This becomes the "neutral" setting in HomeKit's temperature slider
- User can adjust to warmer/cooler within the comfort band
- The predictive algorithm uses this as the baseline

**Example**: Set to `23` for a 21-25°C comfort range.

---

## Location Settings (Required)

Required for weather forecast integration.

### `location.latitude` (required)
**Type**: `number`
**Range**: `-90` to `90`

Location latitude in decimal degrees.

**Examples**:
- Sofia, Bulgaria: `42.6977`
- London, UK: `51.5074`
- New York, USA: `40.7128`

---

### `location.longitude` (required)
**Type**: `number`
**Range**: `-180` to `180`

Location longitude in decimal degrees.

**Examples**:
- Sofia, Bulgaria: `23.3219`
- London, UK: `-0.1278`
- New York, USA: `-74.0060`

**Tip**: Use Google Maps to find your coordinates. Right-click on your location and copy the coordinates.

---

## External Sensor Settings (Required)

Required for accurate room temperature measurement.

### `externalSensor.type`
**Type**: `string` (enum)
**Default**: `"shelly"`

External sensor type. Currently supported:
- `"shelly"` - Shelly Cloud API (H&T sensors)

---

### `externalSensor.shellyServerUri` (required)
**Type**: `string`

Shelly Cloud server URI. Find this in the Shelly App:
1. Open Shelly App
2. Go to User Settings → Cloud
3. Note the server (e.g., `shelly-58-eu.shelly.cloud`)

**Examples**:
- Europe: `shelly-58-eu.shelly.cloud`
- US: `shelly-1-us.shelly.cloud`

---

### `externalSensor.shellyAuthKey` (required)
**Type**: `string`

Shelly Cloud API authentication key. Generate at:
1. Open [Shelly Cloud Control Panel](https://control.shelly.cloud)
2. Go to User Settings → Authorization cloud key
3. Generate and copy the key

---

### `externalSensor.shellyDeviceId` (required)
**Type**: `string`

Shelly device ID. Find this in the Shelly App:
1. Open Shelly App
2. Select your H&T device
3. Go to Settings → Device Information
4. Copy the Device ID

---

### `externalSensor.pollInterval`
**Type**: `integer`
**Default**: `60`
**Range**: `30` - `300` seconds

How often to poll the external sensor for temperature readings.

**Recommendation**: 60 seconds matches well with the MELCloud refresh interval.

---

## InfluxDB Logging (Optional)

Optional thermal data logging for analysis and learning.

### `influxDb.enabled`
**Type**: `boolean`
**Default**: `false`

Enable thermal data logging to InfluxDB.

---

### `influxDb.host`
**Type**: `string`
**Default**: `"localhost"`

InfluxDB server hostname or IP address.

---

### `influxDb.port`
**Type**: `integer`
**Default**: `8086`
**Range**: `1` - `65535`

InfluxDB server port.

---

### `influxDb.database`
**Type**: `string`
**Default**: `"homebridge"`

InfluxDB database name. The database will be created automatically if it doesn't exist.

---

### `influxDb.username`
**Type**: `string`
**Optional**

InfluxDB username (if authentication is enabled).

---

### `influxDb.password`
**Type**: `string`
**Optional**

InfluxDB password (if authentication is enabled).

---

### `influxDb.retentionDays`
**Type**: `integer`
**Default**: `30`
**Range**: `7` - `365`

How long to keep thermal data in InfluxDB.

**Recommendation**: 30 days is sufficient for thermal learning. Longer retention useful for seasonal analysis.

---

## Example Configurations

### Minimal Configuration

```json
{
  "platform": "melcloudpassivehouse",
  "accounts": [
    {
      "name": "Home",
      "user": "your.email@example.com",
      "passwd": "your-password",
      "language": "0",
      "type": "melcloud",
      "ataDevices": [
        {
          "displayType": 1,
          "name": "Climate Control",
          "targetTemperature": 23,
          "location": {
            "latitude": 42.6977,
            "longitude": 23.3219
          },
          "externalSensor": {
            "type": "shelly",
            "shellyServerUri": "shelly-58-eu.shelly.cloud",
            "shellyAuthKey": "your-shelly-auth-key",
            "shellyDeviceId": "your-device-id"
          }
        }
      ]
    }
  ]
}
```

### Full Configuration with InfluxDB

```json
{
  "platform": "melcloudpassivehouse",
  "accounts": [
    {
      "name": "Passive House",
      "user": "your.email@example.com",
      "passwd": "your-password",
      "language": "0",
      "type": "melcloud",
      "refreshInterval": 60,
      "log": {
        "deviceInfo": true,
        "success": true,
        "info": true,
        "warn": true,
        "error": true,
        "debug": false
      },
      "ataDevices": [
        {
          "displayType": 1,
          "name": "Main Floor Climate",
          "targetTemperature": 23,
          "location": {
            "latitude": 42.6977,
            "longitude": 23.3219
          },
          "externalSensor": {
            "type": "shelly",
            "shellyServerUri": "shelly-58-eu.shelly.cloud",
            "shellyAuthKey": "your-shelly-auth-key",
            "shellyDeviceId": "your-device-id",
            "pollInterval": 60
          },
          "influxDb": {
            "enabled": true,
            "host": "192.168.1.100",
            "port": 8086,
            "database": "passive_house",
            "username": "homebridge",
            "password": "influx-password",
            "retentionDays": 90
          }
        }
      ]
    }
  ]
}
```

## Tuning Recommendations

### For Tighter Passive Houses (Air tightness < 0.6)

The building responds slowly to temperature changes. Default settings work well.

### For Less Tight Buildings (Air tightness > 0.8)

The building loses heat faster. Consider:
- Lower `targetTemperature` by 0.5-1°C (algorithm will compensate more aggressively)
- Enable `info` logging to monitor predictions

### For South-Facing Buildings with Large Windows

Solar gains are significant. The algorithm will automatically reduce heating on sunny days.

### For Debugging Issues

1. Enable `log.info` to see prediction calculations:
   ```
   Predict: indoor=21.5°C, outdoor=5°C, target=23°C → setpoint=24°C (Outdoor reset: +0.5°C)
   ```

2. Enable `log.debug` for detailed state machine and action logs:
   ```
   StateMachine: state=HEATING_ACTIVE, deviation=-1.5°C
   ActionExecutor: Sent SetTemp=27°C to MELCloud
   ```

3. Check Homebridge logs for warnings about HomeKit threshold limits.
