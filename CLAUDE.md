# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Homebridge plugin (`homebridge-melcloud-control`) that integrates Mitsubishi HVAC devices (Air Conditioners, Heat Pumps, and Energy Recovery Ventilation systems) with Apple HomeKit via MELCloud or MELCloud Home cloud services.

## Development Commands

No build step is required - this is a pure ES Modules JavaScript project that runs directly on Node.js.

**Run locally with Homebridge:**
```bash
homebridge -D -P /path/to/homebridge-melcloud-control
```

**Publish to npm:**
```bash
npm publish
```

## Architecture

### Entry Point
- `index.js` - Registers the platform plugin with Homebridge, handles account configuration, and instantiates device handlers

### Core Source Files (`src/`)

**Cloud Service Clients:**
- `melcloud.js` - MELCloud (legacy) API client using REST polling
- `melcloudhome.js` - MELCloud Home API client using WebSocket for real-time updates

**Device Type Handlers (exposed as HomeKit accessories):**
- `deviceata.js` - Air Conditioner (ATA) devices → HeaterCooler/Thermostat services
- `deviceatw.js` - Heat Pump (ATW) devices with zones and hot water tank
- `deviceerv.js` - Energy Recovery Ventilation (ERV/Lossnay) devices

**Device-specific MELCloud interfaces:**
- `melcloudata.js` - ATA device state management and API calls
- `melcloudatw.js` - ATW device state management and API calls
- `melclouderv.js` - ERV device state management and API calls

**Supporting Modules:**
- `constants.js` - API URLs, device type enums, operation mode mappings, effective flags
- `functions.js` - Utility functions for file I/O and data handling
- `impulsegenerator.js` - Timer-based polling mechanism using EventEmitter
- `restful.js` - RESTful HTTP server for external integrations
- `mqtt.js` - MQTT client for pub/sub integrations

### Custom UI (`homebridge-ui/`)
- `server.js` - Backend for Homebridge Config UI X custom plugin interface
- `public/index.html` - Frontend for device discovery and configuration

### Key Patterns

**Event-driven architecture:** All major classes extend `EventEmitter` and communicate via events (`success`, `info`, `warn`, `error`, `debug`).

**Two cloud backends:**
- `type: 'melcloud'` - Uses REST API with polling (120s default refresh)
- `type: 'melcloudhome'` - Uses WebSocket for real-time state updates

**Device configuration flow:**
1. Platform loads accounts from `config.json`
2. MelCloud/MelCloudHome client authenticates and fetches device list
3. Configured devices are matched against discovered devices
4. Device handlers create HomeKit accessories with appropriate services

**Effective Flags:** Device control uses bitwise flags (defined in `constants.js`) to specify which properties to update when sending commands to MELCloud API.

## Configuration

Configuration is managed through `config.schema.json` for Homebridge Config UI X. Key config structure:
- `accounts[]` - Array of MELCloud accounts
  - `ataDevices[]` - Air Conditioner devices
  - `atwDevices[]` - Heat Pump devices
  - `ervDevices[]` - ERV devices
  - Each device can have presets, schedules, scenes, and button/sensor configurations
