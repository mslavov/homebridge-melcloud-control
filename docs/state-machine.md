# HVAC State Machine

This document describes the 8-state HVAC control state machine used for passive house climate control. The state machine manages transitions between heating/cooling states with built-in anti-oscillation protection.

## State Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
              ┌──────────┐                                        │
              │ STANDBY  │◄────────────────────────────┐          │
              └────┬─────┘                             │          │
                   │                                   │          │
    ┌──────────────┼──────────────┐                    │          │
    │              │              │                    │          │
    ▼              ▼              ▼                    │          │
┌────────┐   ┌──────────┐   ┌────────────┐            │          │
│PRE_HEAT│   │PRE_COOL  │   │SENSOR_FAULT│            │          │
└───┬────┘   └────┬─────┘   └────────────┘            │          │
    │              │                                   │          │
    ▼              ▼                                   │          │
┌────────┐   ┌──────────┐                              │          │
│HEATING │   │COOLING   │──────────────────────────────┘          │
│ACTIVE  │   │ACTIVE    │                                         │
└───┬────┘   └────┬─────┘                                         │
    │              │                                               │
    ▼              ▼                                               │
┌────────┐   ┌──────────┐                                         │
│HEATING │   │COOLING   │─────────────────────────────────────────┘
│COAST   │   │COAST     │  (thermal mass carries temperature)
└────────┘   └──────────┘
```

## State Definitions

### STANDBY

**Description**: AC is off, room temperature is within the comfort deadband.

**Entry conditions**:
- Temperature within ±2°C of target
- Previous heating/cooling cycle complete
- No anticipatory action needed

**Exit conditions**:
- Temperature deviation exceeds hysteresis threshold
- Cold snap or heatwave detected in forecast

**AC Power**: OFF

---

### HEATING_ACTIVE

**Description**: AC is actively heating the room.

**Entry conditions**:
- Room temperature is below target minus hysteresis (too cold)
- Winter season mode

**Exit conditions**:
- Room temperature reaches within 0.5°C of target → HEATING_COAST
- Minimum on-time (5 minutes) must be satisfied first

**AC Power**: ON
**AC Mode**: HEAT
**Setpoint**: Compensated predictive setpoint

---

### COOLING_ACTIVE

**Description**: AC is actively cooling the room.

**Entry conditions**:
- Room temperature is above target plus hysteresis (too hot)
- Summer season mode

**Exit conditions**:
- Room temperature reaches within 0.5°C of target → COOLING_COAST
- Minimum on-time (5 minutes) must be satisfied first

**AC Power**: ON
**AC Mode**: COOL
**Setpoint**: Compensated predictive setpoint

---

### HEATING_COAST

**Description**: Room is near target after heating. AC maintains low-power operation while thermal mass releases stored heat.

**Entry conditions**:
- Transition from HEATING_ACTIVE when target nearly reached

**Exit conditions**:
- Temperature stable for 2+ hours → STANDBY
- Temperature drops below threshold → HEATING_ACTIVE

**AC Power**: ON (low power / maintaining)
**Setpoint**: Predictive setpoint (coasting)

---

### COOLING_COAST

**Description**: Room is near target after cooling. AC maintains low-power operation while thermal mass absorbs residual heat.

**Entry conditions**:
- Transition from COOLING_ACTIVE when target nearly reached

**Exit conditions**:
- Temperature stable for 2+ hours → STANDBY
- Temperature rises above threshold → COOLING_ACTIVE

**AC Power**: ON (low power / maintaining)
**Setpoint**: Predictive setpoint (coasting)

---

### PRE_HEAT

**Description**: Anticipatory heating triggered by forecast. Cold snap detected 12-36 hours ahead.

**Entry conditions**:
- Winter season mode
- Forecast shows >5°C temperature drop in next 48 hours
- Cold snap arrival is 12-36 hours away (optimal pre-heat window)
- Currently not in a heating state

**Exit conditions**:
- Cold snap arrives → HEATING_ACTIVE
- Forecast changes (cold snap cancelled) → STANDBY

**AC Power**: ON
**AC Mode**: HEAT
**Setpoint**: Slightly elevated to pre-charge thermal mass

---

### PRE_COOL

**Description**: Anticipatory cooling triggered by forecast. Heatwave detected approaching.

**Entry conditions**:
- Summer season mode
- Forecast shows outdoor temp will exceed 30°C in next 48 hours
- Currently not in a cooling state

**Exit conditions**:
- Heatwave arrives → COOLING_ACTIVE
- Forecast changes (heatwave cancelled) → STANDBY

**AC Power**: ON
**AC Mode**: COOL
**Setpoint**: Slightly lowered to pre-cool thermal mass

---

### SENSOR_FAULT

**Description**: External temperature sensor is unavailable. System enters safe mode.

**Entry conditions**:
- External sensor returns null/undefined temperature
- No sensor reading for extended period

**Exit conditions**:
- Sensor reading restored → Previous state

**AC Power**: Maintains last known state
**Action**: None (no control changes)

---

## Anti-Oscillation Parameters

The state machine enforces timing constraints to prevent rapid cycling:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `DEADBAND` | 4.0°C | Total gap between heating and cooling setpoints |
| `HYSTERESIS` | 2.0°C | Deviation required before switching modes |
| `MIN_ON_TIME` | 5 minutes | Minimum runtime once activated |
| `MIN_OFF_TIME` | 3 minutes | Minimum off time before restart |
| `MIN_MODE_SWITCH` | 10 minutes | Minimum time between heat↔cool transitions |
| `COASTING_OVERSHOOT` | 0.5°C | Expected overshoot when entering coast |

### Why These Values?

**Wide Deadband (4°C)**: Passive houses with high thermal mass naturally maintain stable temperatures. A wide deadband accepts this stability rather than fighting it.

**Minimum On-Time (5 minutes)**: Protects compressor from short-cycling. Most AC units should run at least 5 minutes per cycle for efficiency.

**Mode Switch Delay (10 minutes)**: Prevents oscillation between heating and cooling in shoulder seasons. Must pass through STANDBY with a delay.

## Transition Logic

### Temperature-Based Transitions

```javascript
// In winter mode:
if (deviation < -HYSTERESIS) {
    // Too cold, need heating
    return HEATING_ACTIVE;
}
if (deviation > halfDeadband) {
    // Warm enough, can coast or stop
    return isHeating ? HEATING_COAST : STANDBY;
}

// In summer mode:
if (deviation > HYSTERESIS) {
    // Too hot, need cooling
    return COOLING_ACTIVE;
}
if (deviation < -halfDeadband) {
    // Cool enough, can coast or stop
    return isCooling ? COOLING_COAST : STANDBY;
}
```

### Forecast-Based Transitions

```javascript
// Cold snap detection (winter)
const coldSnap = detectColdSnap(forecast);
if (coldSnap && coldSnap.hoursUntil > 12 && coldSnap.hoursUntil <= 36) {
    return PRE_HEAT;
}

// Heatwave detection (summer)
const heatwave = detectHeatwave(forecast);
if (heatwave && forecastPeakTemp >= 30) {
    return PRE_COOL;
}
```

### Timer Guards

Before any transition is allowed, the state machine checks:

```javascript
// Leaving active state (turning off)
if (wasActive && !willBeActive) {
    if (now - lastOnTime < MIN_ON_TIME) {
        return false;  // Blocked, stay in current state
    }
}

// Entering active state (turning on)
if (!wasActive && willBeActive) {
    if (now - lastOffTime < MIN_OFF_TIME) {
        return false;  // Blocked, stay in current state
    }
}

// Mode switch (heat ↔ cool)
if ((wasHeating && willBeCooling) || (wasCooling && willBeHeating)) {
    if (now - lastModeSwitch < MIN_MODE_SWITCH) {
        return false;  // Blocked, stay in current state
    }
}
```

## State Machine Actions

When the state machine transitions or updates, it returns an action:

### `setMode` Action

Returned when entering HEATING_ACTIVE, COOLING_ACTIVE, PRE_HEAT, or PRE_COOL:

```javascript
{
    type: 'setMode',
    mode: 'heat' | 'cool',
    setpoint: 24.5  // Predicted room target
}
```

The ActionExecutor will:
1. Calculate compensated AC setpoint (add sensor offset)
2. Send power ON + mode + setpoint to MELCloud API

### `coast` Action

Returned when:
- Entering STANDBY, HEATING_COAST, or COOLING_COAST
- Staying in same state but setpoint changed significantly (>0.5°C)

```javascript
{
    type: 'coast',
    setpoint: 23.8  // Updated predicted room target
}
```

The ActionExecutor will:
1. Calculate compensated AC setpoint
2. Send just the setpoint update (no mode change)

### `null` Action

Returned when:
- No state change needed
- Setpoint hasn't changed significantly
- Transition blocked by timer guards

No action is sent to the AC.

## State History & Debugging

The state machine maintains a history of the last 50 transitions:

```javascript
{
    from: 'STANDBY',
    to: 'HEATING_ACTIVE',
    timestamp: 1704367200000,
    reason: 'Starting heating - room too cold (-2.5°C)'
}
```

This history can be accessed via `stateMachine.getStateHistory()` for debugging.

## Logging

With debug logging enabled, the state machine logs:

```
StateMachine: state=HEATING_ACTIVE, indoor=21.5°C, target=23°C, deviation=-1.5°C, setpoint=24°C
```

State transitions are logged at info level:

```
Starting heating - room too cold (-2.5°C)
Coasting - target reached (+0.3°C)
Transition blocked by anti-oscillation timer
```

## Season Mode

The state machine operates differently based on season mode:

| Mode | Focus | Active States | Anticipatory States |
|------|-------|---------------|---------------------|
| `winter` | Heating | HEATING_ACTIVE, HEATING_COAST | PRE_HEAT |
| `summer` | Cooling | COOLING_ACTIVE, COOLING_COAST | PRE_COOL |

Season mode is determined by the HomeKit HeaterCooler target state:
- Target state HEAT → winter mode
- Target state COOL → summer mode
- Target state AUTO → determined by current temperature vs target
