import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as jpeg from "jpeg-js";
import request = require("request");
import crypto = require("crypto");
import RequestResponse = request.RequestResponse;

/**
 * Plugin for querying the the space's cameras.
 */
export class CameraPlugin implements Plugin {

    /**
     * Creates a new camera plugin
     * @param config the config to use
     */
    constructor(private config: CameraConfig) {
    }

    public init(matrixClient): void {
        LogService.info("CameraPlugin", "Registering command handler");
        CommandHandler.registerCommand("!camera list", this.cameraListCommand.bind(this), "!camera list - Lists all available cameras");
        CommandHandler.registerCommand("!camera show", this.cameraShowCommand.bind(this), "!camera show <camera> - Gets an image from the camera given");
    }

    private cameraListCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        LogService.verbose("CameraPlugin", "Sending camera list to room " + roomId);
        let lines = this.config.mappings.map(c => c.id.toLowerCase() + " - " + c.description);
        let msg = lines.join("\n");
        matrixClient.sendNotice(roomId, msg + "\n\nUse !camera show <camera name> to see the camera");
    }

    private cameraShowCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        let shortcode: string = null;
        for (let mapping of this.config.mappings) {
            if (mapping.id.toLowerCase() === args[0].toLowerCase()) {
                shortcode = mapping.id;
                break;
            }

            // Check camera aliases too
            for (let alias of mapping.aliases) {
                if (alias.toLowerCase() === args[0].toLowerCase()) {
                    shortcode = mapping.id;
                    break;
                }
            }

            if (shortcode) break;
        }

        if (!shortcode) {
            matrixClient.sendNotice(roomId, "Camera " + args[0] + " not found");
            return;
        }

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