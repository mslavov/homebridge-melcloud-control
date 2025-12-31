import { HeaterCoolerService } from './heater-cooler.js';

/**
 * Service factory that creates HomeKit services for the ATA device
 */
export class ServiceFactory {
    constructor(device) {
        this.device = device;
        this.heaterCooler = new HeaterCoolerService(device);
    }

    async createServices(accessory, accessoryName) {
        const d = this.device;
        const Service = d.Service;
        const Characteristic = d.Characteristic;
        const deviceId = d.deviceId;

        const services = {};

        // Create information service
        if (d.logDebug) d.emit('debug', `Prepare information service`);
        const informationService = accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, d.manufacturer || 'Mitsubishi')
            .setCharacteristic(Characteristic.Model, d.model || 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, d.serialNumber || 'Unknown')
            .setCharacteristic(Characteristic.FirmwareRevision, d.firmwareRevision || '0');
        services.information = informationService;

        // Service name for HomeKit
        const serviceName = `${d.deviceTypeString} ${accessoryName}`;

        // Create HeaterCooler service
        services.main = this.heaterCooler.create(accessory, serviceName, deviceId);

        return services;
    }
}
