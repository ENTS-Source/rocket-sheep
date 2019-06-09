import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import { CameraConfig } from "./CameraPlugin";
import { BlueIrisJsonApi } from "../../blueiris/BlueIrisJsonApi";
import * as moment from "moment";
import { LogService, MatrixClient } from "matrix-bot-sdk";
import striptags = require("striptags");
import * as path from "path";
import * as fs from "fs";
import * as stringTemplate from "string-template";
import * as wkhtmltopdf from "wkhtmltopdf";
import * as streamToArray from "stream-to-array";
import Webserver from "../../api/Webserver";

/**
 * Plugin for querying how active the space is
 */
export class ActivityPlugin implements Plugin {

    private blueIris: BlueIrisJsonApi;

    /**
     * Creates a new activity plugin
     * @param config the config to use
     * @param admins the admins for the bot
     * @param webPort the web server listening port
     */
    constructor(private config: CameraConfig, private admins: string[], private webPort: number) { // yes, this is based on the cameras
        this.blueIris = new BlueIrisJsonApi(config);
    }

    public init(): void {
        LogService.info("ActivityPlugin", "Registering command handler");
        CommandHandler.registerCommand("!activity", this.activityCommand.bind(this), "!activity - Displays how active the space has been recently");
        CommandHandler.registerCommand("!report activity", this.activityReportCommand.bind(this), "!report activity - Generates a report for how active the space has been recently");
    }

    private activityCommand(_cmd: string, _args: string[], roomId: string, event, matrixClient: MatrixClient): void {
        LogService.debug("ActivityPlugin", "Sending space activity to " + roomId);
        const nowSeconds = Math.ceil(moment().utc().valueOf() / 1000); // round to the seconds since the epoch

        // Get clips in the last 24hrs
        this.blueIris.getClipList("index", nowSeconds - (24 * 60 * 60), nowSeconds).then(clips => {
            const areaUsage: { [area: string]: { totalTime: number, mostRecent: number } } = {}; // [area]:milliseconds
            for (let mapping of this.config.mappings) {
                if (mapping.area) areaUsage[mapping.area] = {totalTime: 0, mostRecent: 0};
            }
            for (let clip of clips) {
                let area = null;
                for (let mapping of this.config.mappings) {
                    if (mapping.id.toLowerCase() === clip.camera.toLowerCase() && mapping.area) {
                        area = mapping.area.toLowerCase();
                        break;
                    }
                }

                if (!area) {
                    LogService.warn("ActivityPlugin", "Not counting activity from camera " + clip.camera + " because it has no area assigned");
                    continue;
                }


                areaUsage[area].totalTime += clip.msec;
                if (areaUsage[area].mostRecent === 0 || areaUsage[area].mostRecent < clip.date) areaUsage[area].mostRecent = clip.date;
            }

            let message = "Here's a rough estimate for the last 24 hours at ENTS:\n";
            for (let area of Object.keys(areaUsage)) {
                let usageStr = moment.duration(areaUsage[area].totalTime, 'milliseconds').humanize();
                let recentStr = moment(areaUsage[area].mostRecent * 1000).from(moment().utc());
                message += "The " + area + " was used for " + usageStr + ", most recently " + recentStr + "\n";
            }

            const htmlMessage = striptags(message).replace(/\n/g, '<br/>');

            matrixClient.replyNotice(roomId, event, message, htmlMessage);
        }).catch(err => {
            LogService.error("ActivityPlugin", err);
            matrixClient.replyNotice(roomId, event, "There was an error processing your command");
        });
    }

    private async activityReportCommand(_cmd: string, _args: string[], roomId: string, event, matrixClient: MatrixClient) {
        if (this.admins.indexOf(event['sender']) === -1) {
            matrixClient.sendNotice(roomId, "You do not have the required permissions to run this command.");
            return;
        }

        LogService.debug("AMemberPlugin", "Generating space activity report for " + roomId);
        matrixClient.sendReadReceipt(roomId, event['event_id']);

        let clips = [];
        const bucketsByDay = {}; // {ms day => {area => {hour => ms used}}}

        const nowSeconds = Math.ceil(moment().utc().valueOf() / 1000); // round to the seconds since the epoch
        const stepSize = (24 * 60 * 1000);
        let startIndex = nowSeconds - stepSize;
        do {
            try {
                clips = await this.blueIris.getClipList("index", startIndex, startIndex + stepSize);
                startIndex -= stepSize;

                if (!Array.isArray(clips)) {
                    LogService.error("ActivityPlugin", clips);
                    clips = [];
                }

                for (const clip of clips) {
                    let area = null;
                    for (let mapping of this.config.mappings) {
                        if (mapping.id.toLowerCase() === clip.camera.toLowerCase() && mapping.area) {
                            area = mapping.area.toLowerCase();
                            break;
                        }
                    }

                    if (!area) {
                        LogService.warn("ActivityPlugin", "Not counting activity from camera " + clip.camera + " because it has no area assigned");
                        continue;
                    }

                    const clipMoment = moment.unix(clip.date);

                    let dayMoment = clipMoment.clone().startOf('day');
                    let hour = clipMoment.hour();
                    let msec = clip.msec;
                    do {
                        if (!bucketsByDay[dayMoment.valueOf()]) bucketsByDay[dayMoment.valueOf()] = {};
                        let dayBucket = bucketsByDay[dayMoment.valueOf()];
                        if (!dayBucket[area]) dayBucket[area] = {};
                        let areaBucket = dayBucket[area];
                        if (!areaBucket[hour]) areaBucket[hour] = 0;
                        if (msec <= 3600000) {
                            areaBucket[hour] += msec;
                            msec = 0;
                        } else {
                            areaBucket[hour] += 3600000;
                            msec -= 3600000;
                            hour++;
                            if (hour >= 24) {
                                dayMoment.add(1, 'day');
                                hour = 0;
                            }
                        }
                    } while (msec > 0);
                }
            } catch (e) {
                LogService.error("ActivityPlugin", e);
                clips = [];
            }
        } while (clips.length > 0);

        // TODO: Remove hardcoded areas

        let html = fs.readFileSync(path.join('report_templates', 'activity.html'), {encoding: 'utf8'});
        html = stringTemplate(html, {
            fromDate: moment(Object.keys(bucketsByDay).map(k => Number(k)).sort()[0]).format('MMM DD, YYYY'),
            toDate: moment(Object.keys(bucketsByDay).map(k => Number(k)).sort((a, b) => b - a)[0]).format('MMM DD, YYYY'),
            generatedDate: moment().format('MMM DD, YYYY'),
            overallAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay)),
            woodshopAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay, "woodshop")),
            metalshopAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay, "metalshop")),
            potteryAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay, "pottery studio")),
            mainroomAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay, "mainroom")),
            printingAllTimeData: JSON.stringify(this.aggregateOverallData(bucketsByDay, "printing and crafting area")),
        });

        const reportId = `${moment().format('MMMMDDYYYY')}${(new Date()).getTime()}`;
        Webserver.CACHED_REPORTS[reportId] = html;

        LogService.info("ActivityPlugin", "Generating PDF...");
        wkhtmltopdf(`http://localhost:${this.webPort}/reports/${reportId}`, {
            marginLeft: 0,
            marginRight: 0,
            marginTop: 0,
            marginBottom: 0,
            javascriptDelay: 5000,
            pageSize: "letter",
            noStopSlowScripts: true,
        }, async (err, stream) => {
            delete Webserver.CACHED_REPORTS[reportId];
            if (err) {
                LogService.error("ActivityPlugin", err);
                matrixClient.replyNotice(roomId, event, "Error generating report");
                return;
            }

            try {
                const rawData = await streamToArray(stream);
                const data = [];
                for (const part of rawData) data.push(...part);

                const mxc = await matrixClient.uploadContent(Buffer.from(data), "application/pdf", `ActivityReport_${moment().format('DDMMMYYYY')}.pdf`);
                matrixClient.sendMessage(roomId, {
                    msgtype: "m.file",
                    url: mxc,
                    body: `ActivityReport_${moment().format('DDMMMYYYY')}.pdf`,
                    info: {
                        mimetype: "application/pdf",
                        size: data.length,
                    },
                });
            } catch (e) {
                LogService.error("ActivityPlugin", e);
                matrixClient.replyNotice(roomId, event, "Error uploading report");
            }
        });
    }

    private aggregateOverallData(inputs, targetArea = null) {
        const byDayOfWeek = [];
        for (let i = 0; i < 7; i++) {
            byDayOfWeek.push([]);
            for (let j = 0; j < 24; j++) {
                byDayOfWeek[i].push({x: j, y: 0});
            }
        }

        for (const ts of Object.keys(inputs)) {
            const dayOfWeek = moment(Number(ts)).weekday();
            for (const area of Object.keys(inputs[ts])) {
                if (targetArea && targetArea !== area) continue;
                for (const hour of Object.keys(inputs[ts][area])) {
                    byDayOfWeek[dayOfWeek][Number(hour)].y += inputs[ts][area][hour];
                }
            }
        }

        return byDayOfWeek;
    }
}
