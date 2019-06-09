import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import { CameraConfig } from "./CameraPlugin";
import { BlueIrisJsonApi } from "../../blueiris/BlueIrisJsonApi";
import * as moment from "moment";
import { LogService, MatrixClient } from "matrix-bot-sdk";

/**
 * Plugin for querying how active the space is
 */
export class ActivityPlugin implements Plugin {

    private blueIris: BlueIrisJsonApi;

    /**
     * Creates a new activity plugin
     * @param config the config to use
     */
    constructor(private config: CameraConfig) { // yes, this is based on the cameras
        this.blueIris = new BlueIrisJsonApi(config);
    }

    public init(): void {
        LogService.info("ActivityPlugin", "Registering command handler");
        CommandHandler.registerCommand("!activity", this.activityCommand.bind(this), "!activity - Displays how active the space has been recently");
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

            matrixClient.replyNotice(roomId, event, message);
        }).catch(err => {
            LogService.error("ActivityPlugin", err);
            matrixClient.replyNotice(roomId, event, "There was an error processing your command");
        });
    }
}
