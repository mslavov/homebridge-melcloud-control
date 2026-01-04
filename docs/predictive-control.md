# Predictive Control Algorithm

This document explains the predictive temperature control algorithm used for passive house climate management. The algorithm anticipates heating/cooling needs based on weather forecasts rather than reacting to current temperature deviations.

## Why Predictive Control for Passive Houses?

Passive houses have high thermal mass and excellent insulation, which creates a fundamental challenge:

- **Thermal lag**: Temperature changes take 12-24 hours to manifest
- **Slow response**: Heating/cooling commands don't produce immediate results
- **Overcorrection risk**: Traditional thermostats cause oscillation

**Solution**: Use weather forecasts to anticipate needs and act proactively.

## The 4-Layer Algorithm

The `SetpointCalculator` computes the optimal room temperature target through four additive layers:

```
Final Setpoint = Base User Target
               + Outdoor Reset Curve adjustment
               + Forecast Look-ahead adjustment
               + Solar Gain compensation
               + Error Correction
```

### Layer 1: Outdoor Reset Curve

**Purpose**: Adjust heating/cooling effort based on current outdoor conditions.

**Concept**: In colder weather, we need to heat more aggressively. In warmer weather, less so. This is the classic "outdoor reset" used in hydronic heating systems.

**Formula**:
```javascript
const slope = 0.4;  // Lower for high-mass buildings (0.3-0.5)
const designOutdoorTemp = seasonMode === 'winter' ? 10 : 25;
const tempDiff = designOutdoorTemp - outdoorTemp;
const offset = slope * tempDiff;  // Clamped to ±2°C
```

**Example (Winter)**:
- Design temp: 10°C (where no adjustment needed)
- Current outdoor: 0°C
- Adjustment: 0.4 × (10 - 0) = +4°C → clamped to +2°C

**Interpretation**: When it's 0°C outside, we increase the heating setpoint by 2°C to compensate for higher heat loss.

### Layer 2: Forecast Look-ahead

**Purpose**: Anticipate temperature changes and pre-condition the building.

**Concept**: Weight future temperatures by exponential decay based on the building's time constant. Near-term forecasts matter more than distant ones.

**Formula**:
```javascript
const tau = 18;  // Building time constant in hours
for (let i = 0; i < 24; i++) {
    const weight = Math.exp(-i / tau);
    weightedSum += forecastTemps[i] * weight;
    totalWeight += weight;
}
const weightedFutureTemp = weightedSum / totalWeight;
const expectedChange = weightedFutureTemp - currentOutdoorTemp;
let adjustment = 0.3 * expectedChange;

// In winter: colder future = positive adjustment (preheat)
if (seasonMode === 'winter') {
    adjustment = -adjustment;
}
```

**Example (Winter)**:
- Current outdoor: 5°C
- Weighted future average: 0°C (cold snap coming)
- Expected change: -5°C
- Raw adjustment: 0.3 × (-5) = -1.5°C
- Winter flip: +1.5°C

**Interpretation**: A cold snap is coming, so we increase the setpoint by 1.5°C to pre-heat the thermal mass.

### Layer 3: Solar Gain Compensation

**Purpose**: Reduce heating when significant solar radiation is expected.

**Concept**: On sunny winter days, passive solar gains through windows can provide substantial heating. We should reduce the setpoint to avoid overheating.

**Formula**:
```javascript
const avgSolar = sum(forecastSolar.slice(0, 6)) / 6;  // Next 6 hours

if (avgSolar > 200) {  // W/m² threshold
    const reduction = 0.02 * (avgSolar - 200);
    return Math.max(-2, -reduction);  // Max -2°C reduction
}
```

**Example**:
- Average solar next 6h: 400 W/m²
- Above threshold: 400 - 200 = 200 W/m²
- Reduction: 0.02 × 200 = -4°C → clamped to -2°C

**Interpretation**: Bright sun expected, reduce heating setpoint by 2°C because solar gains will heat the house naturally.

**Note**: This layer only applies in winter mode.

### Layer 4: Error Correction

**Purpose**: Small proportional correction based on current temperature deviation.

**Concept**: If the room is below target, add a small boost. If above, reduce slightly. This handles unmeasured disturbances.

**Formula**:
```javascript
const error = targetTemp - currentTemp;
const Kp = 0.3;  // Proportional gain
const correction = Math.max(-1, Math.min(1, Kp * error));
```

**Example**:
- Target: 23°C
- Current room: 22°C
- Error: +1°C
- Correction: 0.3 × 1 = +0.3°C

**Interpretation**: Room is 1°C below target, so we add 0.3°C to the setpoint to help close the gap.

## Safety Bounds

The algorithm includes safety clamps to prevent extreme adjustments:

### Maximum Deviation from User Target

```javascript
const maxDeviation = 2.0;  // °C

if (seasonMode === 'winter' && setpoint < userTarget - maxDeviation) {
    setpoint = userTarget - maxDeviation;
    // Never heat less than 2°C below what user wants
}

if (seasonMode === 'summer' && setpoint > userTarget + maxDeviation) {
    setpoint = userTarget + maxDeviation;
    // Never cool less than 2°C above what user wants
}
```

### Absolute Range

```javascript
const minSetpoint = 16;
const maxSetpoint = 30;
setpoint = Math.max(minSetpoint, Math.min(maxSetpoint, setpoint));
```

### Rounding

```javascript
// Round to 0.5°C steps for AC compatibility
setpoint = Math.round(setpoint * 2) / 2;
```

## Weather Data Integration

### Open-Meteo API

The plugin fetches weather data from Open-Meteo every 60 minutes:

```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}
  &longitude={lon}
  &hourly=temperature_2m,shortwave_radiation,direct_radiation,cloud_cover,wind_speed_10m
  &forecast_days=2
```

### Parameters Used

| Parameter | Usage |
|-----------|-------|
| `temperature_2m` | Outdoor temperature for reset curve and forecast |
| `shortwave_radiation` | Total solar radiation for gain compensation |
| `direct_radiation` | Direct sunlight component |
| `cloud_cover` | Cloud coverage (not currently used, reserved for future) |
| `wind_speed_10m` | Wind speed (not currently used, reserved for future) |

### Caching

Weather data is cached for 2 hours to reduce API calls and handle temporary outages.

## Building Parameters

The algorithm uses building-specific parameters that can be tuned:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `buildingTimeConstant` | 18 hours | Thermal lag of building |
| `solarGainFactor` | 0.15 | °C rise per 100 W/m² |
| `outdoorResetSlope` | 0.4 | Outdoor reset curve slope |
| `decayConstant` | 6 hours | Forecast weighting decay |
| `forecastHorizon` | 24 hours | How far ahead to look |

### Thermal Learning (Optional)

If InfluxDB is configured, the `ThermalCalibrator` can learn these parameters:

1. **Time Constant**: Measured during HVAC-off periods by observing temperature decay rate
2. **Solar Gain Factor**: Measured during sunny HVAC-off periods by correlating temperature rise with solar radiation

Learned parameters are persisted to disk and loaded on startup.

## Algorithm Output

The `calculateSetpoint` method returns:

```javascript
{
    setpoint: 23.5,           // Final calculated setpoint in °C
    components: {
        base: 24,             // User's comfort target
        outdoorReset: -0.5,   // Adjustment from outdoor conditions
        forecastAdjustment: 0.3,  // Adjustment from forecast
        solarOffset: -0.2,    // Adjustment from solar gains
        errorCorrection: -0.1 // Adjustment from current deviation
    },
    reason: 'Outdoor reset: -0.5°C, Forecast: +0.3°C'
}
```

The `reason` string is logged for observability.

## Example Scenarios

### Scenario 1: Cold Winter Morning

```
User target: 23°C
Outdoor temp: -5°C
Forecast: Getting colder (-10°C tonight)
Solar: 50 W/m² (cloudy)
Room temp: 22.5°C

Layer 1 (Outdoor Reset): +2°C (clamped from +6°C)
Layer 2 (Forecast): +1°C (cold snap coming)
Layer 3 (Solar): 0°C (below threshold)
Layer 4 (Error): +0.15°C (slight deficit)

Final setpoint: 23 + 2 + 1 + 0 + 0.15 = 26.15°C → 26°C (rounded)
Clamped to: 25°C (max +2°C from user target)
```

### Scenario 2: Sunny Winter Afternoon

```
User target: 23°C
Outdoor temp: 8°C
Forecast: Stable around 8°C
Solar: 450 W/m² (sunny)
Room temp: 23.5°C

Layer 1 (Outdoor Reset): +0.8°C
Layer 2 (Forecast): 0°C (stable)
Layer 3 (Solar): -2°C (clamped from -5°C)
Layer 4 (Error): -0.15°C (slightly warm)

Final setpoint: 23 + 0.8 + 0 - 2 - 0.15 = 21.65°C → 21.5°C (rounded)
Clamped to: 21°C (min -2°C from user target)
```

### Scenario 3: Summer Heatwave

```
User target: 24°C
Outdoor temp: 32°C
Forecast: Peak 35°C tomorrow
Room temp: 25°C

Season: Summer (different outdoor reset curve)

Layer 1 (Outdoor Reset): -2.8°C → -2°C (clamped)
Layer 2 (Forecast): -0.9°C (hotter coming)
Layer 3 (Solar): N/A (summer mode)
Layer 4 (Error): -0.3°C (room above target)

Final setpoint: 24 - 2 - 0.9 - 0.3 = 20.8°C → 21°C (rounded)
(Cooling mode: lower setpoint = more aggressive cooling)
```

## Tuning Recommendations

### High Heat Loss Building (Air tightness > 0.8)

- Reduce `buildingTimeConstant` to 12-15 hours
- Increase `outdoorResetSlope` to 0.5-0.6

### Very Tight Passive House (Air tightness < 0.4)

- Increase `buildingTimeConstant` to 24-36 hours
- Reduce `outdoorResetSlope` to 0.2-0.3

### South-Facing Windows (High Solar Gain)

- Increase `solarGainFactor` to 0.2-0.3
- Reduce `SOLAR_REDUCTION_THRESHOLD` to 150 W/m²

### North-Facing or Shaded Building

- Reduce `solarGainFactor` to 0.05-0.1
- Increase `SOLAR_REDUCTION_THRESHOLD` to 300 W/m²
