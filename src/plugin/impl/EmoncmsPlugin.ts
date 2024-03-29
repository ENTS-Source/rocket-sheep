import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as moment from "moment";
import { EmoncmsFeedApi } from "../../emoncms/EmoncmsFeedApi";
import parseDuration from 'parse-duration';
import * as sum from "lodash.sum";
import * as max from "lodash.max";
import { LogService, MatrixClient } from "matrix-bot-sdk";

/**
 * Plugin for reporting power usage of the space
 */
export class EmoncmsPlugin implements Plugin {

    private emoncmsApi: EmoncmsFeedApi;
    private lastRiseTs = -1;
    private lastFallTs = -1;
    private riseState: "rising"|"falling"|"static" = "static";

    /**
     * Creates a new emoncms plugin
     * @param config the config to use
     */
    constructor(private config: EmoncmsConfig) {
        this.emoncmsApi = new EmoncmsFeedApi(config.apiUrl, config.apiKey);
    }

    public init(matrixClient: MatrixClient): void {
        LogService.info("EmoncmsPlugin", "Registering command handler");
        CommandHandler.registerCommand("!kwh", this.kwhCommand.bind(this), "!kwh [from] [until] - Displays information for the kWh usage of the space");

        if (this.config.kwh.notifications.enabled) {
            setInterval(() => this.checkUsage(matrixClient), (this.config.kwh.intervalSeconds * 1000 / 2));
        }
    }

    private async checkUsage(matrixClient: any) {
        LogService.info("EmoncmsPlugin", "Checking for notifications");
        const nowMs = moment().utc().valueOf();
        const startMs = nowMs - ((this.config.kwh.intervalSeconds * 1000) * 6);
        const interval = this.config.kwh.intervalSeconds;
        const minDiff = this.config.kwh.minDeltaPerInterval;
        const promises = [];
        for (const feedId of this.config.kwh.feedIds) {
            promises.push(this.emoncmsApi.getDatapoints(feedId, startMs, nowMs, interval).then(datapoints => {
                const converted = {};
                for (const datapoint of datapoints) {
                    if (!datapoint[1]) continue;
                    converted[datapoint[0]] = Math.abs(datapoint[1]);
                }

                return converted;
            }));
        }

        Promise.all(promises).then(results => {
            const roomId = this.config.kwh.notifications.roomId;
            const riseMsg = this.config.kwh.notifications.riseMessage;
            const fallMsg = this.config.kwh.notifications.fallMessage;

            const timestamps = Object.keys(results).map(k => Number(k));
            const recentTs = max(timestamps);
            const nextRecentTs = max(timestamps.filter(t => t !== recentTs));

            const diff = results[recentTs] - results[nextRecentTs];
            if (minDiff > Math.abs(diff) || diff === 0) return;
            if (diff > 0) {
                if (this.riseState === "rising") return;
                if (this.lastRiseTs < 0 || this.lastRiseTs < (nowMs - (this.config.kwh.minSecondsBeforeRise * 1000))) {
                    this.riseState = "rising";
                    this.lastRiseTs = nowMs;
                    return matrixClient.sendNotice(roomId, riseMsg);
                }
            } else {
                if (this.riseState === "falling") return;
                if (this.lastFallTs < 0 || this.lastFallTs < (nowMs - (this.config.kwh.minSecondsBeforeFall * 1000))) {
                    this.riseState = "falling";
                    this.lastFallTs = nowMs;
                    return matrixClient.sendNotice(roomId, fallMsg);
                }
            }
        }).catch(err => {
            LogService.error("EmoncmsPlugin", err);
        });
    }

    private kwhCommand(_cmd: string, args: string[], roomId: string, event, matrixClient: MatrixClient): void {
        LogService.debug("EmoncmsPlugin", "Sending kWh usage to " + roomId);

        const nowMs = moment().utc().valueOf();

        const startStr = args.length > 0 && args[0] ? args[0] : "4w";
        const endStr = args.length > 1 && args[1] ? args[1] : "now";

        const startMs = nowMs - parseDuration(startStr);
        const endMs = endStr === "now" ? nowMs : (nowMs - parseDuration(endStr));

        if ((endMs - startMs) < 24 * 60 * 60 * 1000) { // 1 day
            matrixClient.replyNotice(roomId, event, "I cannot retrieve data for less than 1 day of time.");
            return;
        }

        const promises = [];
        for (const feedId of this.config.kwh.feedIds) {
            promises.push(this.emoncmsApi.getDailyDatapoints(feedId, startMs, endMs).then(datapoints => {
                let startTs: { v: number, ts: number } = null;
                let endTs: { v: number, ts: number } = null;
                for (const datapoint of datapoints) {
                    if (!datapoint[1]) continue;
                    const abs = Math.abs(datapoint[1]);
                    if (!startTs || startTs.ts > datapoint[0]) startTs = {v: abs, ts: datapoint[0]};
                    if (!endTs || endTs.ts < datapoint[0]) endTs = {v: abs, ts: datapoint[0]};
                }

                return {startTs, endTs};
            }));
        }

        Promise.all(promises).then(results => {
            const start = sum(results.map(r => r.startTs ? r.startTs.v : 0));
            const end = sum(results.map(r => r.endTs ? r.endTs.v : 0));
            const delta = end - start;
            let duration = `since ${moment(startMs).fromNow()}`;
            if (endMs !== nowMs) {
                const format = "D MMM YYYY";
                duration = `between ${moment(startMs).format(format)} and ${moment(endMs).format(format)}`;
            }
            const msg = `${delta.toFixed(2)} kWh used ${duration} (${start.toFixed(2)} kWh - ${end.toFixed(2)} kWh)`;
            matrixClient.replyNotice(roomId, event, msg);
        }).catch(err => {
            LogService.error("EmoncmsPlugin", err);
            matrixClient.replyNotice(roomId, event, "There was an error processing your command");
        });
    }
}

export interface EmoncmsConfig {
    apiKey: string;
    kwh: {
        feedIds: string[];
        intervalSeconds: number;
        minDeltaPerInterval: number;
        minSecondsBeforeRise: number;
        minSecondsBeforeFall: number;
        notifications: {
            enabled: boolean;
            roomId: string;
            riseMessage: string;
            fallMessage: string;
        };
    };
    apiUrl: string;
}
