# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Homebridge plugin (`homebridge-melcloud-control`) that integrates Mitsubishi Air Conditioner (ATA) devices with Apple HomeKit via MELCloud REST API. The plugin supports external temperature sensors (Shelly) for improved temperature accuracy and compensation.

## Development Commands

No build step is required - this is a pure ES Modules JavaScript project that runs directly on Node.js.

**Run locally with Homebridge:**
```bash
homebridge -D -P /path/to/homebridge-melcloud-control
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
2. **`CHANGELOG.md`** - Add a new entry at the top (after the warnings section) following this format:

```markdown
# [X.Y.Z] - (DD.MM.YYYY)

## Changes

- Description of changes
- Additional changes
```

Use the existing changelog entries as reference for formatting and style.

## Architecture

### Entry Point
- `index.js` - Registers the platform plugin with Homebridge, handles account configuration, and instantiates device handlers

### Core Source Files (`src/`)

**Cloud Service Client:**
- `melcloud.js` - MELCloud REST API client with polling-based state updates

**Device Handler (modular folder structure):**
- `deviceata/` - Air Conditioner (ATA) device handler module

**Device-specific MELCloud Interface:**
- `melcloudata.js` - ATA device state management and API calls

**External Sensor Integration:**
- `shellycloud.js` - Shelly Cloud API client for external temperature sensors

**Supporting Modules:**
- `constants.js` - API URLs, device type enums, operation mode mappings, effective flags
- `functions.js` - Utility functions for file I/O and data handling
- `impulsegenerator.js` - Timer-based polling mechanism using EventEmitter

### DeviceAta Module (`src/deviceata/`)

The ATA device handler is organized as a modular folder with separation of concerns:

```
src/deviceata/
├── index.js              # Main DeviceAta class, orchestrates sub-modules
├── external-sensor.js    # Shelly sensor integration & temperature compensation
├── state-parser.js       # Parses MELCloud state → HomeKit accessory state
├── state-updater.js      # Updates HomeKit services from parsed state
└── services/
    ├── index.js          # ServiceFactory - creates HomeKit services
    └── heater-cooler.js  # HeaterCooler service (main AC control)
```

**Design Principles:**

1. **Single Responsibility**: Each module handles one concern (parsing, updating, specific service type)
2. **Dependency Injection**: Sub-modules receive the parent device context, no circular imports
3. **Event-Driven**: The main class extends EventEmitter; sub-modules emit through parent
4. **Stateless Services**: Service modules create HomeKit services but don't hold state
5. **Centralized State**: All runtime state lives in the main DeviceAta class

**Public Interface:**
```javascript
import DeviceAta from './src/deviceata/index.js';

const device = new DeviceAta(api, account, device, defaultTempsFile, accountInfo,
                             accountFile, melcloud, melcloudDevicesList);

const accessory = await device.start();

device.on('devInfo' | 'success' | 'info' | 'debug' | 'warn' | 'error', handler);
```

### Custom UI (`homebridge-ui/`)
- `server.js` - Backend for Homebridge Config UI X custom plugin interface
- `public/index.html` - Frontend for device discovery and configuration

### Test Suite (`test/`)

Uses Node.js built-in test runner (requires Node 20+):

```
test/
├── state-parser.test.js       # Unit tests for state parsing logic
├── deviceata-comparison.test.js # Integration tests for DeviceAta
├── mocks/
│   ├── homebridge-api.js      # Mock Homebridge API (Characteristic, Service, etc.)
│   └── melcloudata-mock.js    # Mock MelCloudAta client
└── fixtures/
    └── device-data.js         # Sample MELCloud device data for tests
```

### Key Patterns

**Event-driven architecture:** All major classes extend `EventEmitter` and communicate via events (`success`, `info`, `warn`, `error`, `debug`).

**REST API with polling:** Uses MELCloud REST API with configurable refresh interval (default 120s).

**External sensor compensation:** When a Shelly temperature sensor is configured, the plugin:
1. Polls the external sensor for actual room temperature
2. Calculates offset between AC sensor and external sensor
3. Compensates target temperature to achieve desired room temperature

**Device configuration flow:**
1. Platform loads accounts from `config.json`
2. MelCloud client authenticates and fetches device list
3. Configured ATA devices are matched against discovered devices
4. DeviceAta handler creates HomeKit accessory with HeaterCooler service

**Effective Flags:** Device control uses bitwise flags (defined in `constants.js`) to specify which properties to update when sending commands to MELCloud API.

## Configuration

Configuration is managed through `config.schema.json` for Homebridge Config UI X. Key config structure:
- `accounts[]` - Array of MELCloud accounts
  - `ataDevices[]` - Air Conditioner devices with:
    - Display type (HeaterCooler only)
    - External sensor configuration (Shelly)
    - Heat/Cool/Auto mode mappings
