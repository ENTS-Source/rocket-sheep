import { LogService } from "matrix-js-snippets";
import config from "../config";
import { RequestResponse } from "request";
import request = require("request");

LogService.info("hw:generate_auth_url", "Starting up...");
if (!config.honeywell.enabled) {
    LogService.error("hw:generate_auth_url", "Honeywell plugin not enabled");
    process.exit(1);
}

request({
    method: "GET",
    url: "https://api.honeywell.com/oauth2/authorize",
    qs: {
        response_type: "code",
        redirect_uri: config.web.externalUrl + "/honeywell",
        client_id: config.honeywell.consumer_key,
    },
    followRedirect: false,
}, (err: any, response: RequestResponse, body: any) => {
    if (err) {
        LogService.error("hw:generate_auth_url", err);
        return;
    }

    if (response.statusCode !== 302) {
        LogService.error("hw:generate_auth_url", response.body);
        return;
    }

    LogService.info("hw:generate_auth_url", "Make sure rocket sheep is running and visit the following URL: ");
    LogService.info("hw:generate_auth_url", response.headers.location);
});