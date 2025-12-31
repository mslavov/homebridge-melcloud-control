/**
 * Mock MelCloudAta for testing
 */
import EventEmitter from 'events';

export class MelCloudAtaMock extends EventEmitter {
    constructor(account, device, defaultTempsFile, accountFile, melcloud) {
        super();
        this.account = account;
        this.device = device;
        this.defaultTempsFile = defaultTempsFile;
        this.accountFile = accountFile;
        this._deviceData = null;
        this._sentCommands = [];
    }

    /**
     * Set the device data that will be emitted on checkState
     */
    setDeviceData(deviceData) {
        this._deviceData = deviceData;
    }

    /**
     * Simulate checkState - emits deviceInfo and deviceState
     */
    async checkState(melcloudDevicesList) {
        // Emit device info
        this.emit('deviceInfo',
            'MSZ-EF25VE3',
            'MUZ-EF25VE',
            '12345678',
            '1.0.0'
        );

        // Wait a tick
        await new Promise(r => setTimeout(r, 10));

        // Emit device state if data is set
        if (this._deviceData) {
            this.emit('deviceState', this._deviceData);
        }
    }

    /**
     * Mock send command - records what was sent
     */
    async send(accountType, displayType, deviceData, flag) {
        this._sentCommands.push({ accountType, displayType, deviceData, flag });
        return { State: true };
    }

    /**
     * Get recorded commands for assertions
     */
    getSentCommands() {
        return this._sentCommands;
    }

    /**
     * Clear recorded commands
     */
    clearSentCommands() {
        this._sentCommands = [];
    }
}

// Mock MelCloud client
export class MelCloudMock extends EventEmitter {
    constructor() {
        super();
        this.client = {};
        this.impulseGenerator = {
            state: async () => {}
        };
    }

    async connect() {
        return { State: true, Info: 'Connected' };
    }

    async checkDevicesList() {
        return {
            State: true,
            Info: 'Success',
            Devices: []
        };
    }
}

export default MelCloudAtaMock;
