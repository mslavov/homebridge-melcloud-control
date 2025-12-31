import { join } from 'path';
import { mkdirSync } from 'fs';
import MelCloud from './src/melcloud.js';
import DeviceAta from './src/deviceata/index.js';
import ImpulseGenerator from './src/impulsegenerator.js';
import { PluginName, PlatformName, DeviceType } from './src/constants.js';

class MelCloudPlatform {
	constructor(log, config, api) {
		// only load if configured
		if (!config || !Array.isArray(config.accounts)) {
			log.warn(`No configuration found for ${PluginName}`);
			return;
		}
		this.accessories = [];
		const accountsName = [];

		//create directory if it doesn't exist
		const prefDir = join(api.user.storagePath(), 'melcloud');
		try {
			//create directory if it doesn't exist
			mkdirSync(prefDir, { recursive: true });
		} catch (error) {
			log.error(`Prepare directory error: ${error.message ?? error}`);
			return;
		}

		api.on('didFinishLaunching', async () => {
			//loop through accounts
			for (const account of config.accounts) {
				const { name, user, passwd, language, type } = account;
				if (!name || accountsName.includes(name) || !user || !passwd || !language || !type) {
					log.warn(`Account ${!name ? 'name missing' : (accountsName.includes(name) ? 'name duplicated' : name)} ${!user ? ', user missing' : ''}${!passwd ? ', password missing' : ''}${!language ? ', language missing' : ''}${!type ? ', type disabled' : ''} in config, will not be published in the Home app`);
					continue;
				}
				accountsName.push(name);
				const accountRefreshInterval = (account.refreshInterval ?? 120) * 1000

				//log config
				const logLevel = {
					devInfo: account.log?.deviceInfo,
					success: account.log?.success,
					info: account.log?.info,
					warn: account.log?.warn,
					error: account.log?.error,
					debug: account.log?.debug
				};

				if (logLevel.debug) {
					log.info(`${name}, debug: did finish launching.`);
					const safeConfig = {
						...account,
						passwd: 'removed'
					};
					log.info(`${name}, Config: ${JSON.stringify(safeConfig, null, 2)}`);
				}

				//define directory and file paths
				const accountFile = `${prefDir}/${name}_Account`;
				const buildingsFile = `${prefDir}/${name}_Buildings`;

				try {
					//create impulse generator
					const impulseGenerator = new ImpulseGenerator()
						.on('start', async () => {
							try {
								//melcloud account
								if (account.type !== 'melcloud') {
									if (logLevel.warn) log.warn(`Unknown account type: ${account.type}. Only 'melcloud' is supported.`);
									return;
								}
								const timmers = [{ name: 'checkDevicesList', sampling: accountRefreshInterval }];
								const melcloud = new MelCloud(account, accountFile, buildingsFile, true);
								melcloud.on('success', (msg) => log.success(`${name}, ${msg}`))
									.on('info', (msg) => log.info(`${name}, ${msg}`))
									.on('debug', (msg) => log.info(`${name}, debug: ${msg}`))
									.on('warn', (msg) => log.warn(`${name}, ${msg}`))
									.on('error', (msg) => log.error(`${name}, ${msg}`));

								//connect
								const accountInfo = await melcloud.connect();
								if (!accountInfo?.State) {
									if (logLevel.warn) log.warn(`${name}, ${accountInfo?.Info}`);
									return;
								}
								if (logLevel.success) log.success(`${name}, ${accountInfo.Info}`);

								//check devices list
								const melcloudDevicesList = await melcloud.checkDevicesList();
								if (!melcloudDevicesList.State) {
									if (logLevel.warn) log.warn(`${name}, ${melcloudDevicesList.Info}`);
									return;
								}
								if (logLevel.debug) log.info(melcloudDevicesList.Info);
								await new Promise(r => setTimeout(r, 1000));

								//start account impulse generator
								await melcloud.impulseGenerator.state(true, timmers, false);

								//configured ATA devices only
								const devices = (account.ataDevices || []).filter(device => device.id != null && String(device.id) !== '0');
								if (logLevel.debug) log.info(`${name}, found ${devices.length} configured ATA devices.`);

								for (const [index, device] of devices.entries()) {
									device.id = String(device.id);
									const deviceName = device.name;
									const deviceType = device.type;
									const deviceTypeString = DeviceType[device.type];
									const defaultTempsFile = `${prefDir}/${name}_${device.id}_Temps`;

									//chack device is not disabled in config
									const displayType = device.displayType;
									if (!displayType) {
										if (logLevel.warn) log.warn(`${name}, ${deviceTypeString}, ${deviceName}, disabled in configuration, will not be published in the Home app.`);
										continue;
									}

									//chack device from config exist on melcloud
									const deviceInMelCloud = melcloudDevicesList.Devices.find(d => d.DeviceID === device.id);
									if (!deviceInMelCloud) {
										if (logLevel.warn) log.warn(`${name}, ${deviceTypeString}, ${deviceName}, not exist on server, please login to MELCLoud from plugin UI to fix this issue.`);
										continue;
									}

									//only ATA devices supported
									if (deviceType !== 0) {
										if (logLevel.warn) log.warn(`${name}, ${deviceTypeString}, ${deviceName}, only ATA devices are supported.`);
										continue;
									}

									const configuredDevice = new DeviceAta(api, account, device, defaultTempsFile, accountInfo, accountFile, melcloud, melcloudDevicesList);

									configuredDevice.on('devInfo', (info) => logLevel.devInfo && log.info(info))
										.on('success', (msg) => log.success(`${name}, ${deviceTypeString}, ${deviceName}, ${msg}`))
										.on('info', (msg) => log.info(`${name}, ${deviceTypeString}, ${deviceName}, ${msg}`))
										.on('debug', (msg) => log.info(`${name}, ${deviceTypeString}, ${deviceName}, debug: ${msg}`))
										.on('warn', (msg) => log.warn(`${name}, ${deviceTypeString}, ${deviceName}, ${msg}`))
										.on('error', (msg) => log.error(`${name}, ${deviceTypeString}, ${deviceName}, ${msg}`));

									const accessory = await configuredDevice.start();
									if (accessory) {
										api.publishExternalAccessories(PluginName, [accessory]);
										if (logLevel.success) log.success(`${name}, ${deviceTypeString}, ${deviceName}, Published as external accessory.`);
									}
								}

								//stop start impulse generator
								await impulseGenerator.state(false);
							} catch (error) {
								if (logLevel.error) log.error(`${name}, Start impulse generator error, ${error.message ?? error}, trying again.`);
							}
						}).on('state', (state) => {
							if (logLevel.debug) log.info(`${name}, Start impulse generator ${state ? 'started' : 'stopped'}.`);
						});

					//start impulse generator
					await impulseGenerator.state(true, [{ name: 'start', sampling: 120000 }]);
				} catch (error) {
					if (logLevel.error) log.error(`${name}, Did finish launching error: ${error.message ?? error}.`);
				}
			}
		});
	}

	configureAccessory(accessory) {
		this.accessories.push(accessory);
	}
}

export default (api) => {
	api.registerPlatform(PluginName, PlatformName, MelCloudPlatform);
}
