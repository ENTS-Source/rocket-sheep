import { CameraConfig } from "../plugin/impl/CameraPlugin";
import * as Promise from "bluebird";
import { RequestResponse } from "request";
import * as md5 from "md5";
import { ClipListItem } from "./responses";
import { LogService } from "matrix-js-snippets";
import request = require("request");

export class BlueIrisJsonApi {

    private sessionId: string;
    private authString: string;

    constructor(private config: CameraConfig) {
    }

    public login(): Promise<any> {
        return this.doCall({cmd: "login"}, true).then(response => {
            this.sessionId = response['session'];
            this.authString = md5(this.config.api.username + ":" + this.sessionId + ":" + this.config.api.password);
            return this.doCall({cmd: "login", session: this.sessionId, response: this.authString});
        });
    }

    public getClipList(camera: string, startTime: number, endTime: number, tiles = false): Promise<ClipListItem[]> {
        return this.callCommand("cliplist", {
            camera: camera,
            startdate: startTime,
            enddate: endTime,
            tiles: tiles,
        });
    }

    private callCommand(cmd: string, data: any): Promise<any> {
        data['cmd'] = cmd;
        return this.doAuthedCall(data).then(r => r['data']);
    }

    private doAuthedCall(cmd: any, expectingFail = false): Promise<any> {
        // We have to log in constantly otherwise we can have the token expire
        return this.login().then(() => {
            cmd['session'] = this.sessionId;
            cmd['response'] = this.authString;
            return this.doCall(cmd, expectingFail)
        }).finally(() => this.doCall({cmd: "logout", "session": this.sessionId, "response": this.authString}));
    }

    private doCall(cmd: any, expectingFail = false): Promise<any> {
        LogService.verbose("BlueIrisJsonApi", "Sending command: " + JSON.stringify(cmd));
        return new Promise((resolve, reject) => {
            request.post(this.config.api.base_url + "/json", {
                json: cmd,
                encoding: null
            }, (error: any, _response: RequestResponse, body: any) => {
                if (error) {
                    reject(error);
                    return;
                }

                LogService.verbose("BlueIrisJsonApi", body);
                if (!expectingFail && body['result'] === 'fail') {
                    reject(body);
                    return;
                }

                resolve(body);
            });
        });
    }
}