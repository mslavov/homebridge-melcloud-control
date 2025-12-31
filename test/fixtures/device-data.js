/**
 * Sample MELCloud device data fixtures for testing
 */

// Sample ATA device data from MELCloud API
export const sampleDeviceData = {
    Device: {
        DeviceID: '12345',
        DeviceName: 'Living Room AC',
        DeviceType: 0,
        Power: true,
        OperationMode: 3, // COOL
        SetTemperature: 24,
        RoomTemperature: 26.5,
        OutdoorTemperature: 32,
        ActualFanSpeed: 3,
        AutomaticFanSpeed: false,
        FanSpeed: 3,
        SetFanSpeed: 3,
        VaneVerticalDirection: 3,
        VaneVerticalSwing: false,
        VaneHorizontalDirection: 3,
        VaneHorizontalSwing: false,
        InStandbyMode: false,
        HasOutdoorTemperature: true,
        HasAutomaticFanSpeed: true,
        NumberOfFanSpeeds: 5,
        ModelSupportsFanSpeed: true,
        ModelSupportsAuto: true,
        ModelSupportsHeat: true,
        ModelSupportsDry: true,
        ModelSupportsStandbyMode: true,
        AirDirectionFunction: true,
        SwingFunction: true,
        ModelSupportsWideVane: true,
        TemperatureIncrement: true, // 0.5 degree steps
        Offline: false,
        HasError: false,
        DefaultHeatingSetTemperature: 21,
        DefaultCoolingSetTemperature: 24,
        MinTempHeat: 10,
        MaxTempHeat: 31,
        MaxTempAutomatic: 31,
        ProhibitSetTemperature: false,
        ProhibitOperationMode: false,
        ProhibitPower: false
    }
};

// Device in heating mode
export const heatingDeviceData = {
    ...sampleDeviceData,
    Device: {
        ...sampleDeviceData.Device,
        Power: true,
        OperationMode: 1, // HEAT
        SetTemperature: 22,
        RoomTemperature: 18.5
    }
};

// Device in auto mode
export const autoDeviceData = {
    ...sampleDeviceData,
    Device: {
        ...sampleDeviceData.Device,
        Power: true,
        OperationMode: 8, // AUTO
        SetTemperature: 23,
        RoomTemperature: 22.5
    }
};

// Device powered off
export const offDeviceData = {
    ...sampleDeviceData,
    Device: {
        ...sampleDeviceData.Device,
        Power: false,
        InStandbyMode: false
    }
};

// Device in standby mode
export const standbyDeviceData = {
    ...sampleDeviceData,
    Device: {
        ...sampleDeviceData.Device,
        Power: true,
        InStandbyMode: true
    }
};

// Sample account configuration
export const sampleAccount = {
    name: 'TestAccount',
    user: 'test@example.com',
    passwd: 'testpass',
    language: 'en',
    type: 'melcloud',
    refreshInterval: 120,
    log: {
        deviceInfo: false,
        success: false,
        info: false,
        warn: true,
        error: true,
        debug: false
    }
};

// Sample device configuration
export const sampleDeviceConfig = {
    id: '12345',
    name: 'Living Room AC',
    type: 0,
    displayType: 1, // HeaterCooler
    heatDryFanMode: 1,
    coolDryFanMode: 1,
    autoDryFanMode: 1,
    externalSensor: {
        enabled: false
    }
};

// Account info
export const sampleAccountInfo = {
    useFahrenheit: false
};

// MelCloud devices list response
export const sampleMelcloudDevicesList = {
    State: true,
    Info: 'Success',
    Devices: [
        { DeviceID: '12345' }
    ]
};

export default {
    sampleDeviceData,
    heatingDeviceData,
    autoDeviceData,
    offDeviceData,
    standbyDeviceData,
    sampleAccount,
    sampleDeviceConfig,
    sampleAccountInfo,
    sampleMelcloudDevicesList
};
