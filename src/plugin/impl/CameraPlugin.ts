import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as jpeg from "jpeg-js";
import request = require("request");
import crypto = require("crypto");
import parseDuration from 'parse-duration';
import * as moment from "moment";
import RequestResponse = request.RequestResponse;
import { LogService, MatrixClient } from "matrix-bot-sdk";
import * as sharp from "sharp";
import * as PImage from "pureimage";
import {PassThrough} from "node:stream";

/**
 * Plugin for querying the the space's cameras.
 */
export class CameraPlugin implements Plugin {

    private activeCheckins: { [roomId: string]: { [shortcode: string]: { endTime: number, sender: string, timer: any, cleared: boolean } } } = {};

    /**
     * Creates a new camera plugin
     * @param config the config to use
     */
    constructor(private config: CameraConfig, private adminUserIds: string[]) {
    }

    public init(): void {
        LogService.info("CameraPlugin", "Registering command handler");
        CommandHandler.registerCommand("!camera list", this.cameraListCommand.bind(this), "!camera list - Lists all available cameras");
        CommandHandler.registerCommand("!camera show", this.cameraShowCommand.bind(this), "!camera show <camera> - Gets an image from the camera given");
        CommandHandler.registerCommand("!camera checkin", this.cameraCheckinCommand.bind(this), "!camera checkin <camera> <duration> - Polls a camera at regular intervals for <duration> amount of time");
        CommandHandler.registerCommand("!camera checkout", this.cameraCheckoutCommand.bind(this), "!camera checkout - Cancels any camera polls (from !camera checkin) you have");

        const font = PImage.registerFont(this.config.homeAssistant.fontPath, "ENTS");
        font.loadSync();
    }

    private cameraListCommand(_cmd: string, _args: string[], roomId: string, event, matrixClient: MatrixClient): void {
        LogService.debug("CameraPlugin", "Sending camera list to room " + roomId);
        let lines = this.config.mappings.map(c => c.id.toLowerCase() + " - " + c.description);
        let msg = lines.join("\n");
        matrixClient.replyNotice(roomId, event, msg + "\n\nUse !camera show <camera name> to see the camera");
    }

    private cameraShowCommand(_cmd: string, args: string[], roomId: string, _sender: string, matrixClient: any): void {
        let shortcode: string = this.parseShortcode(args[0]);
        if (!shortcode) {
            matrixClient.replyNotice(roomId, event, "Camera " + args[0] + " not found");
            return;
        }

        this.sendCameraImage(shortcode, roomId, matrixClient);
    }

    private cameraCheckinCommand(_cmd: string, args: string[], roomId: string, event, matrixClient: any): void {
        let shortcode: string = this.parseShortcode(args[0]);
        if (!shortcode) {
            matrixClient.replyNotice(roomId, event, "Camera " + args[0] + " not found");
            return;
        }

        if (this.activeCheckins[roomId]) {
            const existingRegistration = this.activeCheckins[roomId][shortcode];
            if (existingRegistration && Date.now() < existingRegistration.endTime && !existingRegistration.cleared) {
                matrixClient.replyNotice(roomId, event, "Someone has already started a checkin for " + shortcode);
                return;
            }
        }

        let workPeriod = args[1];
        if (!workPeriod) {
            matrixClient.replyNotice(roomId, event, "Please tell me how long you'll be working for. Eg: !camera checkin woodshop 2h");
            return;
        }

        const registration = {sender: event['sender'], duration: parseDuration(workPeriod), timer: null, endTime: 0, cleared: false};
        if (registration.duration <= 0) {
            matrixClient.replyNotice(roomId, event, "Please enter a positive work period.");
            return;
        }
        registration.endTime = Date.now() + registration.duration;

        if (registration.duration > 8 * 60 * 60 * 1000) {
            matrixClient.replyNotice(roomId, event, "Please enter a work period less than 8 hours");
            return;
        }

        let interval = 15 * 60 * 1000; // 15 minutes by default
        registration.timer = setInterval(() => {
            this.sendCameraImage(shortcode, roomId, matrixClient);
            if (Date.now() >= registration.endTime && !registration.cleared) {
                clearInterval(registration.timer);
                registration.cleared = true;

                // Note: we don't use sendNotice because we want to try pinging the user.

                // TODO: Proper mention (needs bot-sdk support)
                const pilled = '<a href="https://matrix.to/#/' + event['sender'] + '">' + event['sender'] + "</a>: your checkin has expired";
                const plain = event['sender'] + ": your checkin has expired";
                matrixClient.sendMessage(roomId, {
                    msgtype: "m.text",
                    body: plain,
                    format: "org.matrix.custom.html",
                    formatted_body: pilled,
                });
            }
        }, interval);

        if (!this.activeCheckins[roomId]) this.activeCheckins[roomId] = {};
        this.activeCheckins[roomId][shortcode] = registration;

        const intervalStr = moment.duration(interval, 'milliseconds').humanize();
        const durationStr = moment.duration(registration.duration, 'milliseconds').humanize();
        matrixClient.replyNotice(roomId, event, "Okay, I'll update this room with an image from " + shortcode + " every " + intervalStr + " for " + durationStr + ". To cancel, say !camera checkout");
    }

    private cameraCheckoutCommand(_cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        if (!this.activeCheckins[roomId]) {
            matrixClient.replyNotice(roomId, event, "You don't have an active checkin here.");
            return;
        }

        const isDirector = this.adminUserIds.indexOf(sender) !== -1;

        let cleared = false;
        for (const shortcode in this.activeCheckins[roomId]) {
            const registration = this.activeCheckins[roomId][shortcode];
            if (Date.now() >= registration.endTime || registration.cleared) continue;
            if (registration.sender === sender || (isDirector && shortcode === args[0])) {
                clearInterval(registration.timer);
                registration.cleared = true;
                cleared = true;
                matrixClient.replyNotice(roomId, event, "I've cleared your checkin for " + shortcode);
            }
        }

        if (!cleared) matrixClient.replyNotice(roomId, event, "You don't have an active checkin here.");
    }

    private sendCameraImage(shortcode: string, roomId: string, matrixClient: any): void {
        let imgWidth = 0;
        let imgHeight = 0;
        let imgSize = 0;
        this.getImage(shortcode).then(img => {
            imgWidth = img.width;
            imgHeight = img.height;
            imgSize = img.data.length;
            return matrixClient.uploadContent(img.data, 'image/jpeg', `${shortcode}.jpg`);
        }).then(mxc => {
            let event = {
                msgtype: "m.image",
                url: mxc,
                body: shortcode + ".jpg",
                info: {
                    mimetype: "image/jpeg",
                    size: imgSize,
                    w: imgWidth,
                    h: imgHeight
                }
            };
            LogService.info("CameraPlugin", "Sending camera image " + shortcode + " to room " + roomId);
            LogService.debug("CameraPlugin", event);
            return matrixClient.sendMessage(roomId, event);
        }).then(eventId => {
            LogService.debug("CameraPlugin", "Event for image " + shortcode + ": " + eventId);
        }).catch(err => {
            LogService.error("CameraPlugin", "Error processing command for camera " + shortcode);
            LogService.error("CameraPlugin", err);
            matrixClient.sendNotice(roomId, "Error getting camera image. Please try again later.");
        });
    }

    private parseShortcode(shortcode: string): string {
        for (let mapping of this.config.mappings) {
            if (mapping.id.toLowerCase() === shortcode.toLowerCase()) {
                return mapping.id;
            }

            // Check camera aliases too
            for (let alias of mapping.aliases) {
                if (alias.toLowerCase() === shortcode.toLowerCase()) {
                    return mapping.id;
                }
            }
        }

        return null; // Not found
    }

    private getImage(shortcode: string): Promise<{ width: number, height: number, data: Buffer }> {
        LogService.debug("CameraPlugin", "Getting image for shortcode: ", shortcode);
        const altLink = this.config.mappings.find(m => m.id === shortcode)?.altDownloadUrl;
        let imgPromise: Promise<any>;
        if (altLink) {
            imgPromise = new Promise<any>((resolve, reject) => {
                request.get(altLink, (error: any, _response: RequestResponse, body: any) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(body);
                    }
                });
            });
        } else {
            imgPromise = this.getSession().then(session => {
                return new Promise<{ width: number, height: number, data: Buffer }>((resolve, reject) => {
                    request.get(this.config.api.base_url + "/image/" + shortcode, {
                        qs: {q: 40, session: session.sessionId, w: 800, h: 600},
                        headers: {
                            "Cookie": "session=" + session.sessionId,
                        },
                        encoding: null,
                    }, (error: any, _response: RequestResponse, body: any) => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve(body);
                    });
                });
            });
        }

        let airQualityPromise: Promise<number> = Promise.resolve(-1);
        if (this.config.homeAssistant.enabled) {
            const device = this.config.homeAssistant.airQuality.find(q => q.cameraId.toLowerCase() === shortcode.toLowerCase());
            if (device) {
                airQualityPromise = new Promise((resolve, reject) => {
                    request.get(this.config.homeAssistant.address + "/api/states/" + device.deviceId, {
                        headers: {
                            "Authorization": "Bearer " + this.config.homeAssistant.token,
                        },
                    }, (error: any, response: RequestResponse, body: any) => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve(body);
                    });
                }).then((b: string) => Number(JSON.parse(b).state));
            }
        }

        return Promise.all([imgPromise, airQualityPromise]).then(([body, airQuality]) => {
            try {
                let jpegInfo = jpeg.decode(body);
                if (airQuality >= 0 && Number.isInteger(airQuality)) {
                    const img = PImage.make(200, 50);

                    // Draw static UI first
                    const ctx = img.getContext('2d');
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, 200, 50);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '16px ENTS';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    if (airQuality <= 35) {
                        ctx.fillText("GOOD AIR QUALITY", 1, 10);
                    } else if (airQuality <= 60) {
                        ctx.fillText("OKAY AIR QUALITY", 1, 10);
                    } else {
                        ctx.fillText("BAD AIR QUALITY", 1, 10);
                    }
                    ctx.fillText("Current: " + airQuality + " PM2.5", 1, 30);

                    const passThroughStream = new PassThrough();
                    const pngData = [];
                    passThroughStream.on("data", (chunk) => pngData.push(chunk));
                    passThroughStream.on("end", () => {});
                    return PImage.encodePNGToStream(img, passThroughStream).then(() => {
                        return sharp(body).composite([{input: Buffer.concat(pngData), left: 10, top: 30}]).jpeg({quality: 100}).toBuffer().then(buf => {
                            jpegInfo.data = buf; // override data with known-good image
                            return jpegInfo;
                        });
                    });
                }
                jpegInfo.data = body; // override data with known-good image
                return jpegInfo;
            } catch (err) {
                throw err;
            }
        });
    }

    private getSession(): Promise<{ sessionId: string, responseId: string }> {
        return new Promise((resolve, reject) => {
            // Start a new session
            LogService.debug("CameraPlugin", "Starting first request");
            request.post(this.config.api.base_url + "/json", {
                body: JSON.stringify({"cmd": "login"}),
                headers: {
                    "Content-Type": "text/plain",
                },
            }, (error: any, response: RequestResponse, body: any) => {
                LogService.debug("CameraPlugin", body);
                if (error) {
                    reject(error);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject("Bad status code: " + response.statusCode);
                    return;
                }

                try {
                    const r = JSON.parse(body);

                    // We don't validate the response here because blue iris always says 'fail'
                    // if (r["result"] !== "success") {
                    //     reject("Failed request: " + body);
                    //     return;
                    // }

                    // Finish the auth to get a proper response and session ID
                    const sessionId = r["session"];
                    const responseId = crypto.createHash('md5').update(this.config.api.username + ":" + sessionId + ":" + this.config.api.password).digest("hex");
                    LogService.debug("CameraPlugin", "Starting second request", responseId);
                    request.post(this.config.api.base_url + "/json", {
                        json: {"cmd": "login", "session": sessionId, "response": responseId},
                        encoding: null,
                    }, (error2: any, response2: RequestResponse, body2: any) => {
                        LogService.debug("CameraPlugin", body2);
                        if (error2) {
                            reject(error2);
                            return;
                        }

                        if (response2.statusCode !== 200) {
                            reject("Bad status code for 2nd request: " + response2.statusCode);
                            return;
                        }

                        try {
                            if (body2["result"] !== "success") {
                                reject("Failed 2nd request: " + body2);
                                return;
                            }

                            resolve({sessionId, responseId});
                        } catch (err) {
                            reject(err);
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
    }
}

export interface CameraConfig {
    api: {
        username: string;
        password: string;
        base_url: string;
    };
    mappings: {
        id: string;
        description: string;
        aliases: string[];
        area?: string; // optional
        altDownloadUrl?: string;
    }[];
    homeAssistant: {
        enabled: boolean;
        address: string;
        token: string;
        fontPath: string;
        airQuality: {
            cameraId: string;
            deviceId: string;
        }[];
    };
}
