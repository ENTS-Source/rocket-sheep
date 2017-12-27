import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import HoneywellToken from "../../db/models/HoneywellToken";
import { RequestResponse } from "request";
import * as _ from "lodash";
import * as striptags from "striptags";
import request = require("request");

/**
 * Plugin for interacting with Honeywell thermostats.
 */
export class HoneywellPlugin implements Plugin {

    /**
     * Creates a new honeywell plugin
     * @param config the config to use
     */
    constructor(private config: HoneywellConfig) {
        setInterval(this.checkTokenAuth.bind(this), 60000); // Check every minute for an updated token
        this.checkTokenAuth();
    }

    public init(matrixClient): void {
        LogService.info("HoneywellPlugin", "Registering command handler");
        CommandHandler.registerCommand("!temperature", this.temperatureCommand.bind(this), "!temperature - Displays the current temperature for each thermostat");
    }

    private temperatureCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        HoneywellToken.findAll().then(tokens => {
            if (!tokens || tokens.length === 0) {
                LogService.warn("HoneywellPlugin", "No oauth tokens found - cannot get temperature!");
                matrixClient.sendNotice(roomId, "No devices found");
                return;
            }

            return this.getThermostatInfoFor(tokens);
        }).then(devices => {
            const deviceMap: { [id: string]: HW_Thermostat } = {};
            for (const device of devices) {
                if (deviceMap[device.deviceID]) continue;
                deviceMap[device.deviceID] = device;
            }
            const thermostats = _.values(deviceMap);

            if (thermostats.length === 0) {
                matrixClient.sendNotice(roomId, "No devices found");
                return;
            }

            let responseHtml = `<b>Outside:</b> ${thermostats[0].outdoorTemperature}°C (${thermostats[0].displayedOutdoorHumidity}% humidity)<br />`;
            for (const thermostat of thermostats) {
                const nameChange = this.config.alternative_names.find(n => n.current_name === thermostat.name);
                const name = nameChange ? nameChange.display_name : thermostat.name;
                responseHtml += `<b>${name}:</b> ${thermostat.indoorTemperature}°C<br />`;
            }

            matrixClient.sendMessage(roomId, {
                msgtype: "m.notice",
                body: striptags(responseHtml),
                format: "org.matrix.custom.html",
                formatted_body: responseHtml,
            });
        });
    }

    private checkTokenAuth() {
        const now = new Date().getTime();
        LogService.info("HoneywellPlugin", "Checking token expirations...");
        HoneywellToken.findAll().then(tokens => {
            tokens.forEach(t => {
                if (t.expirationTs <= now) {
                    LogService.info("HoneywellPlugin", "Renewing oauth token " + t.id);
                    this.renewToken(t);
                } else {
                    const timeLeft = t.expirationTs - now;
                    LogService.info("HoneywellPlugin", "Token " + t.id + " not due for a renew for another " + timeLeft + "ms");
                }
            });
        });
    }

    private renewToken(token: HoneywellToken) {
        const authHeader = new Buffer(this.config.consumer_key + ":" + this.config.consumer_secret).toString("base64");
        request({
            method: "POST",
            url: "https://api.honeywell.com/oauth2/token",
            headers: {
                "Authorization": authHeader,
            },
            encoding: null,
            form: {
                grant_type: "refresh_token",
                refresh_token: token.refreshToken,
            }
        }, (error: any, response: RequestResponse, body: any) => {
            if (error) {
                LogService.error("HoneywellPlugin", error);
                return;
            }

            LogService.info("HoneywellPlugin", "Successfully renewed token " + token.id);
            const tokenInfo = JSON.parse(response.body);
            token.expirationTs = new Date().getTime() + ((tokenInfo["expires_in"] / 2) * 1000);
            token.refreshToken = tokenInfo["refresh_token"];
            token.accessToken = tokenInfo["access_token"];
            token.save();
        });
    }

    private getThermostatInfoFor(tokens: HoneywellToken[]): Promise<HW_Thermostat[]> {
        let promises = [];
        tokens.forEach(t => promises.push(this.getThermostatInfo(t)));
        return Promise.all(promises).then(_.flatten);
    }

    private getThermostatInfo(token: HoneywellToken): Promise<HW_Thermostat[]> {
        return this.getLocations(token).then(locations => {
            let promises = [];
            locations.forEach(i => promises.push(this.getThermostats(token, i.locationID)));
            return Promise.all(promises).then(_.flatten);
        });
    }

    private getThermostats(token: HoneywellToken, locationId: number): Promise<HW_Thermostat[]> {
        return new Promise((resolve, reject) => {
            request({
                method: "GET",
                url: "https://api.honeywell.com/v2/devices/thermostats",
                headers: {
                    "Authorization": "Bearer " + token.accessToken,
                },
                qs: {
                    apikey: this.config.consumer_key,
                    locationId: locationId,
                },
            }, (err: any, response: RequestResponse, body: any) => {
                if (err) {
                    LogService.error("HoneywellPlugin", err);
                    reject(err);
                    return;
                }

                if (response.statusCode !== 200) {
                    LogService.error("HoneywellPlugin", response.body);
                    reject("Error processing response");
                    return;
                }

                const devices = JSON.parse(response.body);
                resolve(devices);
            });
        });
    }

    private getLocations(token: HoneywellToken): Promise<HW_Location[]> {
        return new Promise((resolve, reject) => {
            request({
                method: "GET",
                url: "https://api.honeywell.com/v2/locations",
                headers: {
                    "Authorization": "Bearer " + token.accessToken,
                },
                qs: {
                    apikey: this.config.consumer_key,
                },
            }, (err: any, response: RequestResponse, body: any) => {
                if (err) {
                    LogService.error("HoneywellPlugin", err);
                    reject(err);
                    return;
                }

                if (response.statusCode !== 200) {
                    LogService.error("HoneywellPlugin", response.body);
                    reject("Error processing response");
                    return;
                }

                const locations = JSON.parse(response.body);
                resolve(locations);
            });
        });
    }
}

interface HoneywellConfig {
    consumer_key: string;
    consumer_secret: string;
    alternative_names: {
        current_name: string;
        display_name: string;
    }[];
}

interface HW_Location {
    locationID: number;
    // and other things we don't care about
}

interface HW_Thermostat {
    deviceID: string;
    name: string;
    indoorTemperature: number;
    outdoorTemperature: number;
    displayedOutdoorHumidity: number; // 0-100 (percent)
    // and other things we don't care about
}