# Temperature Terminology

This document establishes the standard terminology for all temperature-related concepts in the homebridge-melcloud-passive-house plugin. Use these terms consistently in code, logs, documentation, and discussions.

## Quick Reference

| Term | Description | Code Variable |
|------|-------------|---------------|
| **AC Sensor Temp** | What the AC's internal sensor reads | `acCurrentTemp` |
| **AC Setpoint** | Temperature command sent to the AC | `acSetpoint` |
| **Room Temperature** | Actual room temp from external sensor | `roomCurrentTemp` |
| **Outdoor Temp** | Current outside temperature | `currentOutdoorTemp` |
| **Forecast Temps** | Future hourly outdoor temps | `forecastTemps` |
| **User Comfort Target** | User's desired temperature (HomeKit) | `userTargetTemperature` |
| **Base Target Temp** | Optimal temp for season (config) | `targetTemperature` |
| **Comfort Offset** | User target minus base target | (derived) |
| **Predicted Room Target** | Algorithm's calculated target | `predictedSetpoint` |
| **Compensated AC Setpoint** | What actually goes to AC | (derived) |
| **Sensor Offset** | AC sensor minus room temp | `temperatureOffset` |

## Detailed Definitions

### AC Sensor Temperature
**What it is**: The temperature reading from the AC unit's built-in sensor, typically located inside the indoor unit near the ceiling or under the roof in a ducted system.

**Why it's unreliable**: In winter, this sensor often reads several degrees lower than the actual room temperature because:
- It measures air returning to the unit, which may be cooler
- In ducted systems, it reads post-recuperator air
- Heat rises, so the sensor at ceiling level may read differently than living space

**Current variable**: `acCurrentTemp`, `Device.RoomTemperature`

**Example**: AC sensor reads 18°C while actual room is 22°C.

---

### AC Setpoint
**What it is**: The temperature command we send to the AC unit via MELCloud API. This is what the AC tries to achieve based on its own sensor.

**Important**: This is NOT the actual room temperature we want. Because the AC sensor is unreliable, we "trick" the AC by sending a compensated setpoint.

**Current variable**: `acSetpoint`, `SetTemperature` (from MELCloud API)

**Example**: We send 27°C to the AC so it keeps heating until the room (measured by Shelly) reaches 23°C.

---

### Room Temperature (External Sensor)
**What it is**: The actual room temperature measured by the external Shelly sensor. This is the "ground truth" we use for all control decisions.

**Why we use it**: The Shelly sensor is placed in the living space at human height, giving an accurate reading of the temperature people actually experience.

**Current variable**: `roomCurrentTemp` (when external sensor is enabled)

**Note on current implementation**: The sensor is currently in the master bedroom. Future multi-zone support will allow different sensors for different areas.

---

### Outdoor Temperature (Current)
**What it is**: The current outside temperature, obtained from the Open-Meteo weather API.

**Used for**:
- Outdoor reset curve calculations
- Determining heating vs cooling need
- Calculating sensor offset (in some conditions)

**Current variable**: `currentOutdoorTemp`

---

### Outdoor Temperature (Forecast)
**What it is**: An array of hourly outdoor temperatures for the next 24-48 hours, from Open-Meteo.

**Used for**:
- Predictive setpoint adjustments
- Cold snap / heatwave detection
- Solar gain anticipation

**Current variable**: `forecastTemps`

---

### User Comfort Target
**What it is**: The temperature the user sets via HomeKit. Due to HomeKit limitations, this is shown as an absolute temperature (e.g., 24°C), but conceptually we interpret it as a relative preference from the base target.

**How to interpret**: If base target is 23°C and user sets 24°C, the user wants "+1°C warmer than optimal".

**Range**: Typically the base target ± 2-3°C (HomeKit requires minimum 20°C)

**Current variable**: `userTargetTemperature`

---

### Base Target Temperature
**What it is**: The "optimal" or "neutral" temperature for the season, configured in Homebridge config.json. This serves as the midpoint of the comfort range shown in HomeKit.

**Default**: 23°C

**Purpose**: Provides a reference point for:
- The center of the HomeKit temperature slider
- Calculating the user's relative comfort preference
- Determining the comfort band for state machine decisions

**Current variable**: `targetTemperature`

---

### Comfort Offset (Relative)
**What it is**: The difference between the user's comfort target and the base target. This represents the user's preference as a relative adjustment.

**Calculation**: `comfortOffset = userTargetTemperature - baseTargetTemperature`

**Example**: User sets 24°C, base is 23°C → comfort offset is +1°C

**Why this matters**: The predictive algorithm uses this relative value to adjust its calculations. A "+1°C" preference is applied on top of all the weather-based adjustments.

---

### Predicted Room Target
**What it is**: The optimal room temperature calculated by the SetpointCalculator algorithm, taking into account:
- User's comfort target
- Current outdoor temperature (outdoor reset curve)
- Forecast temperatures (look-ahead adjustment)
- Solar radiation (solar gain compensation)
- Current room temperature (error correction)

**Current variable**: `predictedSetpoint`, `lastCalculatedSetpoint`

**Example**: User wants 24°C, but algorithm calculates 23.5°C because it's sunny and solar gains will provide extra heat.

---

### Compensated AC Setpoint
**What it is**: The final temperature value sent to the AC, adjusted for the difference between the AC sensor and the external room sensor.

**Calculation**: `compensatedSetpoint = predictedRoomTarget + sensorOffset`

**Why needed**: The AC "thinks" in terms of its own sensor. If AC reads 4°C lower than reality, we add 4°C to our target so the AC keeps running until the room actually reaches our target.

**Current variable**: `lastCompensatedTarget` (in ExternalSensor module)

---

### Sensor Offset
**What it is**: The difference between the AC's sensor reading and the external sensor reading.

**Calculation**: `sensorOffset = acSensorTemp - roomTemperature`

**Typical values**:
- Winter: -3°C to -6°C (AC reads lower because cool return air)
- Summer: +1°C to +3°C (AC reads higher because warm return air)

**Current variable**: `temperatureOffset`

---

## Temperature Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER INPUT (via HomeKit)                                            │
│                                                                     │
│   User Comfort Target: 24°C (shown as absolute in HomeKit)          │
│                    ↓                                                │
│   Base Target: 23°C (config midpoint)                               │
│                    ↓                                                │
│   Comfort Offset = 24°C - 23°C = +1°C (interpreted as relative)     │
└─────────────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PREDICTIVE ALGORITHM (SetpointCalculator)                           │
│                                                                     │
│   User Comfort Target (24°C)                                        │
│   + Outdoor Reset Curve adjustment (-0.5°C cold outside)            │
│   + Forecast Look-ahead adjustment (+0.3°C getting colder)          │
│   + Solar Gain compensation (-0.2°C sunny day)                      │
│   + Error Correction (+0.2°C room below target)                     │
│                    ↓                                                │
│   = Predicted Room Target: 23.8°C                                   │
└─────────────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ TEMPERATURE COMPENSATION (ExternalSensor)                           │
│                                                                     │
│   Room Temp (Shelly): 22°C                                          │
│   AC Sensor Temp: 18°C                                              │
│   Sensor Offset = 18°C - 22°C = -4°C (AC reads lower in winter)     │
│                    ↓                                                │
│   Compensated AC Setpoint = 23.8°C + 4°C = 27.8°C                   │
│   (We tell AC "27.8°C" so it keeps running until room reaches 23.8) │
└─────────────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ AC UNIT (Mitsubishi via MELCloud)                                   │
│                                                                     │
│   Receives: SetTemperature = 27.8°C                                 │
│   AC Sensor reads: 18°C                                             │
│   Delta: 27.8 - 18 = 9.8°C → Full heating power                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Insight: Delta-Based Control

The AC unit doesn't care about absolute temperatures - it cares about the **delta** between its setpoint and its sensor reading:

- **Large delta (>5°C)**: Full power heating/cooling
- **Medium delta (2-5°C)**: Moderate power
- **Small delta (<2°C)**: Low power or standby

By manipulating the AC setpoint (adding the sensor offset), we control the AC's power output while targeting the actual room temperature measured by the Shelly sensor.

## Future: Multi-Zone Support

Currently, the external sensor is in the master bedroom. Future versions will support multiple zones with different temperature profiles:

| Zone | Day Target | Night Target | Notes |
|------|------------|--------------|-------|
| Master Bedroom | 22°C | 18-19°C | Lower for better sleep |
| Living Areas | 22-23°C | 20°C | Higher during active hours |
| Office | 22°C | 18°C | When occupied |

This will require:
- Multiple Shelly sensors (one per zone)
- Zone-based temperature profiles with schedules
- Weighted average or zone priority logic
