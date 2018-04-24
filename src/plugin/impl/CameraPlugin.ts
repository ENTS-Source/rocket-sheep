import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as jpeg from "jpeg-js";
import request = require("request");
import crypto = require("crypto");
import parseDuration = require('parse-duration');
import moment = require("moment");
import RequestResponse = request.RequestResponse;

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

    public init(matrixClient): void {
        LogService.info("CameraPlugin", "Registering command handler");
        CommandHandler.registerCommand("!camera list", this.cameraListCommand.bind(this), "!camera list - Lists all available cameras");
        CommandHandler.registerCommand("!camera show", this.cameraShowCommand.bind(this), "!camera show <camera> - Gets an image from the camera given");
        CommandHandler.registerCommand("!camera checkin", this.cameraCheckinCommand.bind(this), "!camera checkin <camera> <duration> - Polls a camera at regular intervals for <duration> amount of time");
        CommandHandler.registerCommand("!camera checkout", this.cameraCheckoutCommand.bind(this), "!camera checkout - Cancels any camera polls (from !camera checkin) you have");
    }

    private cameraListCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        LogService.verbose("CameraPlugin", "Sending camera list to room " + roomId);
        let lines = this.config.mappings.map(c => c.id.toLowerCase() + " - " + c.description);
        let msg = lines.join("\n");
        matrixClient.sendNotice(roomId, msg + "\n\nUse !camera show <camera name> to see the camera");
    }

    private cameraShowCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        let shortcode: string = this.parseShortcode(args[0]);
        if (!shortcode) {
            matrixClient.sendNotice(roomId, "Camera " + args[0] + " not found");
            return;
        }

        this.sendCameraImage(shortcode, roomId, matrixClient);
    }

    private cameraCheckinCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        let shortcode: string = this.parseShortcode(args[0]);
        if (!shortcode) {
            matrixClient.sendNotice(roomId, "Camera " + args[0] + " not found");
            return;
        }

        if (this.activeCheckins[roomId]) {
            const existingRegistration = this.activeCheckins[roomId][shortcode];
            if (existingRegistration && Date.now() < existingRegistration.endTime && !existingRegistration.cleared) {
                matrixClient.sendNotice(roomId, "Someone has already started a checkin for " + shortcode);
                return;
            }
        }

        let workPeriod = args[1];
        if (!workPeriod) {
            matrixClient.sendNotice(roomId, "Please tell me how long you'll be working for. Eg: !camera checkin woodshop 2h");
            return;
        }

        const registration = {sender: sender, duration: parseDuration(workPeriod), timer: null, endTime: 0, cleared: false};
        if (registration.duration <= 0) {
            matrixClient.sendNotice(roomId, "Please enter a positive work period.");
            return;
        }
        registration.endTime = Date.now() + registration.duration;

        if (registration.duration > 8 * 60 * 60 * 1000) {
            matrixClient.sendNotice(roomId, "Please enter a work period less than 8 hours");
            return;
        }

        let interval = 15 * 60 * 1000; // 15 minutes by default
        registration.timer = setInterval(() => {
            this.sendCameraImage(shortcode, roomId, matrixClient);
            if (Date.now() >= registration.endTime && !registration.cleared) {
                clearInterval(registration.timer);
                registration.cleared = true;

                // Note: we don't use sendNotice because we want to try pinging the user.

                matrixClient.getProfileInfo(sender, "displayname").then(result => {
                    if (!result.displayname) result.displayname = sender;
                    const pilled = '<a href="https://matrix.to/#/' + sender + '">' + result.displayname + "</a>: your checkin has expired";
                    const plain = result.displayname + ": your checkin has expired";
                    matrixClient.sendMessage(roomId, {
                        msgtype: "m.text",
                        body: plain,
                        format: "org.matrix.custom.html",
                        formatted_body: pilled,
                    });
                }).catch(() => {
                    matrixClient.sendTextMessage(roomId, sender + ": your checkin has expired");
                });
            }
        }, interval);

        if (!this.activeCheckins[roomId]) this.activeCheckins[roomId] = {};
        this.activeCheckins[roomId][shortcode] = registration;

        const intervalStr = moment.duration(interval, 'milliseconds').humanize();
        const durationStr = moment.duration(registration.duration, 'milliseconds').humanize();
        matrixClient.sendNotice(roomId, "Okay, I'll update this room with an image from " + shortcode + " every " + intervalStr + " for " + durationStr + ". To cancel, say !camera checkout");
    }

    private cameraCheckoutCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        if (!this.activeCheckins[roomId]) {
            matrixClient.sendNotice(roomId, "You don't have an active checkin here.");
            return;
        }

        const isDirector = this.adminUserIds.indexOf(sender) !== -1;

        let cleared = false;
        for (const shortcode in this.activeCheckins[roomId]) {
            const registration = this.activeCheckins[roomId][shortcode];
            if (Date.now() >= registration.endTime || registration.cleared) continue;
            if (registration.sender == sender || (isDirector && shortcode === args[0])) {
                clearInterval(registration.timer);
                registration.cleared = true;
                cleared = true;
                matrixClient.sendNotice(roomId, "I've cleared your checkin for " + shortcode);
            }
        }

        if (!cleared) matrixClient.sendNotice(roomId, "You don't have an active checkin here.");
    }

    private sendCameraImage(shortcode: string, roomId: string, matrixClient: any): void {
        let imgWidth = 0;
        let imgHeight = 0;
        let imgSize = 0;
        this.getImage(shortcode).then(img => {
            imgWidth = img.width;
            imgHeight = img.height;
            imgSize = img.data.length;
            return matrixClient.uploadContent(img.data, {
                name: shortcode + ".jpg",
                type: 'image/jpeg',
                rawResponse: false
            });
        }).then(mxc => {
            let event = {
                msgtype: "m.image",
                url: mxc["content_uri"],
                body: shortcode + ".jpg",
                info: {
                    mimetype: "image/jpeg",
                    size: imgSize,
                    w: imgWidth,
                    h: imgHeight
                }
            };
            LogService.info("CameraPlugin", "Sending camera image " + shortcode + " to room " + roomId);
            LogService.verbose("CameraPlugin", event);
            return matrixClient.sendMessage(roomId, event);
        }).then(eventId => {
            LogService.verbose("CameraPlugin", "Event for image " + shortcode + ": " + eventId);
        }).catch(err => {
            LogService.error("CameraPlugin", "Error processing command for camera " + shortcode);
            LogService.error("CameraPlugin", err);
            matrixClient.sendNotice(roomId, "Error getting camera image. Please try again later.")
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
        return this.getSession().then(session => {
            return new Promise<{ width: number, height: number, data: Buffer }>((resolve, reject) => {
                request.get(this.config.api.base_url + "/image/" + shortcode, {
                    qs: {q: 40},
                    headers: {
                        "Cookie": "session=" + session.sessionId
                    },
                    encoding: null
                }, (error: any, response: RequestResponse, body: any) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    try {
                        let jpegInfo = jpeg.decode(body);
                        jpegInfo.data = body; // override data with known-good image
                        resolve(jpegInfo);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });
    }

    private getSession(): Promise<{ sessionId: string, responseId: string }> {
        return new Promise((resolve, reject) => {
            // Start a new session
            LogService.verbose("CameraPlugin", "Starting first request");
            request.post(this.config.api.base_url + "/json", {
                body: JSON.stringify({"cmd": "login", "session": null, "response": null}),
                headers: {
                    "Content-Type": "text/plain",
                },
            }, (error: any, response: RequestResponse, body: any) => {
                LogService.verbose("CameraPlugin", body);
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
                    LogService.verbose("CameraPlugin", "Starting second request");
                    request.post(this.config.api.base_url + "/json", {
                        json: {"cmd": "login", "session": sessionId, "response": responseId},
                    }, (error: any, response: RequestResponse, body: any) => {
                        LogService.verbose("CameraPlugin", body);
                        if (error) {
                            reject(error);
                            return;
                        }

                        if (response.statusCode !== 200) {
                            reject("Bad status code for 2nd request: " + response.statusCode);
                            return;
                        }

                        try {
                            if (body["result"] !== "success") {
                                reject("Failed 2nd request: " + body);
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
        area: string; // optional
    }[];
}