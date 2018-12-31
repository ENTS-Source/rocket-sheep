import { GET, Path, QueryParam } from "typescript-rest";
import * as Promise from "bluebird";
import { ApiError } from "../ApiError";
import config from "../../config";
import { LogService } from "matrix-js-snippets";
import { RequestResponse } from "request";
import HoneywellToken from "../../db/models/HoneywellToken";
import request = require("request");

//@Path("/honeywell")
export class HoneywellApiService {

    @GET
    @Path("/honeywell")
    public onCode(@QueryParam("code") code: string): Promise<any> {
        if (!config.honeywell.enabled) {
            throw new ApiError(401, "Plugin not enabled");
        }

        // This is the best assumption we can make given our requirements
        if (!code) {
            return Promise.resolve({"status": "ok", "message": "You may now close this window"});
        }

        return new Promise<any>((resolve, reject) => {
            const authHeader = new Buffer(config.honeywell.consumer_key + ":" + config.honeywell.consumer_secret).toString("base64");
            request({
                method: "POST",
                url: "https://api.honeywell.com/oauth2/token",
                headers: {
                    "Authorization": "Basic " + authHeader,
                },
                form: {
                    grant_type: "authorization_code",
                    code: code,
                    redirect_uri: config.web.externalUrl + "/honeywell",
                },
            }, (err: any, response: RequestResponse, _body: any) => {
                if (err) {
                    LogService.error("HoneywellApiService", err);
                    reject(new ApiError(500, "Internal server error"));
                    return;
                }
                if (response.statusCode !== 200) {
                    LogService.error("HoneywellApiService", "Received " + response.statusCode + " instead of 200 OK");
                    LogService.error("HoneywellApiService", response.body);
                    reject(new ApiError(500, "Internal server error"));
                    return;
                }

                const tokenInfo = JSON.parse(response.body);

                HoneywellToken.create({
                    accessToken: tokenInfo["access_token"],
                    refreshToken: tokenInfo["refresh_token"],
                    expirationTs: new Date().getTime() + ((tokenInfo["expires_in"] / 2) * 1000),
                }).then(_token => {
                    LogService.info("HoneywellApiService", "New token registered");
                    resolve({"status": "ok", "message": "You may now close this window"});
                }).catch(err2 => {
                    LogService.error("HoneywellApiService", err2);
                    reject(new ApiError(500, "Internal server error"));
                });
            });
        });
    }

}