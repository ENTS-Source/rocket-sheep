import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as moment from "moment";
import { EmoncmsFeedApi } from "../../emoncms/EmoncmsFeedApi";
import parseDuration = require('parse-duration');

/**
 * Plugin for reporting power usage of the space
 */
export class EmoncmsPlugin implements Plugin {

    private emoncmsApi: EmoncmsFeedApi;

    /**
     * Creates a new emoncms plugin
     * @param config the config to use
     */
    constructor(private config: EmoncmsConfig) {
        this.emoncmsApi = new EmoncmsFeedApi(config.apiUrl, config.apiKey);
    }

    public init(matrixClient): void {
        LogService.info("EmoncmsPlugin", "Registering command handler");
        CommandHandler.registerCommand("!kwh", this.kwhCommand.bind(this), "!kwh [from] [until] - Displays information for the kWh usage of the space");
    }

    private kwhCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        LogService.verbose("EmoncmsPlugin", "Sending kWh usage to " + roomId);

        const nowMs = moment().utc().valueOf();

        const startStr = args.length > 0 ? args[0] : "4w";
        const endStr = args.length > 1 ? args[1] : "now";

        const startMs = nowMs - parseDuration(startStr);
        const endMs = endStr === "now" ? nowMs : (nowMs - parseDuration(endStr));

        const promises = [];
        for (const feed of this.config.feeds) {
            promises.push(this.emoncmsApi.getDailyDatapoints(feed.kwhId, startMs, endMs).then(datapoints => {
                let total = 0;
                for (const datapoint of datapoints) {
                    if (!datapoint[1]) continue;
                    total += datapoint[1];
                }

                return {feed: feed, kwh: total};
            }));
        }

        Promise.all(promises).then(results => {
            let output = "";
            for (const result of results) {
                output += result.feed.name + ": " + result.kwh.toFixed(2) + " kWh\n";
            }
            if (!output.trim()) output = "No data";
            return matrixClient.sendNotice(roomId, output);
        }).catch(err => {
            LogService.error("EmoncmsPlugin", err);
            return matrixClient.sendNotice(roomId, "There was an error processing your command");
        });
    }
}

export interface EmoncmsConfig {
    apiKey: string;
    feeds: {
        kwhId: string;
        name: string;
    }[];
    apiUrl: string;
}