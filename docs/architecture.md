# System Architecture

This document describes the architecture of the homebridge-melcloud-passive-house plugin, including component responsibilities, data flow, and integration points.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HOMEKIT                                        │
│                                                                             │
│   iPhone/iPad/Mac Home App                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  HeaterCooler Accessory                                             │   │
│   │  - Active (on/off)                                                  │   │
│   │  - Current Temperature (from external sensor)                       │   │
│   │  - Target Temperature (user comfort preference)                     │   │
│   │  - Mode (heat/cool/auto)                                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↕ HAP Protocol
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HOMEBRIDGE                                       │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  homebridge-melcloud-passive-house plugin                           │   │
│   │                                                                     │   │
│   │   ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │   │
│   │   │ MelCloudAta │  │ ShellyCloud  │  │ DeviceAta                │   │   │
│   │   │ (API client)│  │ (API client) │  │ (Device handler)         │   │   │
│   │   └──────┬──────┘  └──────┬───────┘  │                          │   │   │
│   │          │                │          │  ┌──────────────────────┐│   │   │
│   │          │                │          │  │ PredictiveController ││   │   │
│   │          │                │          │  │ (Weather + Algorithm)││   │   │
│   │          │                │          │  └──────────────────────┘│   │   │
│   │          │                │          └──────────────────────────┘   │   │
│   │          │                │                                         │   │
│   └──────────┼────────────────┼─────────────────────────────────────────┘   │
└──────────────┼────────────────┼─────────────────────────────────────────────┘
               ↓                ↓
┌──────────────────────┐  ┌─────────────────┐  ┌──────────────────────┐
│     MELCloud API     │  │   Shelly Cloud  │  │    Open-Meteo API    │
│                      │  │                 │  │                      │
│  Mitsubishi AC       │  │  Temperature    │  │  Weather Forecast    │
│  Control & Status    │  │  Sensors        │  │  (48h ahead)         │
└──────────────────────┘  └─────────────────┘  └──────────────────────┘
```

## Component Details

### Entry Point: `index.js`

Registers the platform plugin with Homebridge and handles:
- Account configuration loading
- Device discovery per account
- Instantiation of device handlers

### Cloud API Clients

#### MelCloudAta (`src/melcloudata.js`)
- Authenticates with MELCloud REST API
- Polls device status at configurable intervals
- Sends control commands (power, mode, setpoint)
- Manages session tokens and refresh

#### ShellyCloud (`src/shellycloud.js`)
- Connects to Shelly Cloud API
- Retrieves temperature readings from H&T sensors
- Caches readings to reduce API calls

### Device Handler: DeviceAta (`src/deviceata/`)

The main orchestrator for each AC device. Structured as a modular system:

```
src/deviceata/
├── index.js                     # Main DeviceAta class
├── external-sensor.js           # Shelly integration & compensation
├── state-parser.js              # MELCloud state → HomeKit state
├── state-updater.js             # Updates HomeKit characteristics
├── action-executor.js           # Executes state machine actions
├── services/
│   ├── index.js                 # ServiceFactory
│   └── heater-cooler.js         # HeaterCooler service handlers
├── predictive/
│   ├── index.js                 # PredictiveController
│   ├── weather-client.js        # Open-Meteo integration
│   ├── setpoint-calculator.js   # 4-layer algorithm
│   ├── state-machine.js         # 8-state HVAC control
│   └── constants.js             # Configuration constants
└── thermal/                     # Optional thermal learning
    ├── index.js                 # ThermalManager
    ├── influx-client.js         # InfluxDB client
    └── thermal-calibrator.js    # Parameter learning
```

### Predictive Control Module

#### PredictiveController (`predictive/index.js`)
Orchestrates the predictive control system:
- Initializes weather client and setpoint calculator
- Manages the state machine
- Coordinates updates on each polling cycle

#### WeatherClient (`predictive/weather-client.js`)
- Fetches 48-hour forecasts from Open-Meteo
- Caches responses for 2 hours
- Provides current outdoor temp and forecast arrays

#### SetpointCalculator (`predictive/setpoint-calculator.js`)
Implements the 4-layer predictive algorithm:
1. Outdoor Reset Curve
2. Forecast Look-ahead
3. Solar Gain Compensation
4. Error Correction

See [Predictive Control](./predictive-control.md) for details.

#### StateMachine (`predictive/state-machine.js`)
Manages 8 HVAC states with anti-oscillation protection:
- STANDBY, HEATING_ACTIVE, COOLING_ACTIVE
- PRE_HEAT, PRE_COOL (anticipatory)
- HEATING_COAST, COOLING_COAST (near target)
- SENSOR_FAULT

See [State Machine](./state-machine.md) for details.

### Thermal Learning Module (Optional)

When InfluxDB is configured:

#### ThermalManager (`thermal/index.js`)
- Logs temperature data every 5 minutes
- Triggers daily calibration at 3 AM
- Persists learned parameters to disk

#### ThermalCalibrator (`thermal/thermal-calibrator.js`)
- Analyzes historical data to learn building characteristics
- Estimates building time constant
- Estimates solar gain factor

## Data Flow

### Polling Cycle (Every 60 seconds)

```
1. MelCloudAta polls MELCloud API
   └── Returns: AC sensor temp, AC setpoint, power state, mode

2. ShellyCloud polls Shelly API
   └── Returns: Room temperature (external sensor)

3. WeatherClient checks forecast cache
   └── Returns: Current outdoor temp, 48h forecast

4. SetpointCalculator computes optimal setpoint
   └── Inputs: User target, room temp, outdoor temp, forecast
   └── Returns: Predicted room target + reason

5. StateMachine processes update
   └── Inputs: Room temp, target, predicted setpoint, season mode
   └── Returns: State + action (or null)

6. ActionExecutor executes action (if any)
   └── Calculates compensated setpoint
   └── Sends command to MELCloud API

7. StateUpdater updates HomeKit characteristics
   └── Updates current temp, target temp, state
```

### User Control Flow

```
1. User changes temperature in HomeKit
   └── Triggers setCharacteristic callback

2. HeaterCooler service handler receives change
   └── Validates temperature range

3. DeviceAta stores new user target
   └── userTargetTemperature updated

4. Next polling cycle picks up new target
   └── SetpointCalculator uses new value
   └── StateMachine may trigger new action
```

## Integration Points

### MELCloud API

**Endpoint**: `https://app.melcloud.com/Mitsubishi.Wifi.Client/`

**Key Operations**:
- `Login/` - Authentication
- `User/ListDevices` - Device discovery
- `Device/Get` - Status polling
- `Device/SetAta` - Control commands

**Polling Rate**: Configurable, default 60 seconds

### Shelly Cloud API

**Endpoint**: `https://shelly-{region}-g2.shelly.cloud/`

**Key Operations**:
- Device status with temperature readings

**Polling Rate**: Synced with MELCloud polling

### Open-Meteo API

**Endpoint**: `https://api.open-meteo.com/v1/forecast`

**Parameters**:
- `temperature_2m` - Outdoor temperature
- `shortwave_radiation` - Solar radiation
- `direct_radiation` - Direct solar
- `cloud_cover` - Cloud coverage
- `wind_speed_10m` - Wind speed

**Polling Rate**: Every 60 minutes (cache: 2 hours)

## Event-Driven Architecture

All major classes extend `EventEmitter` and communicate via events:

| Event | Emitter | Description |
|-------|---------|-------------|
| `success` | All | Operation completed successfully |
| `info` | All | Informational message |
| `warn` | All | Warning condition |
| `error` | All | Error occurred |
| `debug` | All | Debug information |
| `stateChange` | StateMachine | HVAC state transition |
| `externalTemperature` | ExternalSensor | New temperature reading |

## File Storage

The plugin stores persistent data in Homebridge's storage path:

```
{storagePath}/melcloud/
├── {deviceId}_external_sensor.json    # Sensor offset cache
└── {deviceId}_thermal_params.json     # Learned building parameters
```
