import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import { PointsTracker } from "../../points/PointsTracker";
import { LogService, MatrixClient } from "matrix-bot-sdk";

/**
 * Plugin for tracking an arbitrary number of points
 */
export class PointsPlugin implements Plugin {

    private pointsTracker: PointsTracker;

    /**
     * Creates a new points plugin
     * @param config the config to use
     * @param admins the admins for the bot
     */
    constructor(private config: PointsConfig, private admins: string[]) {
    }

    public init(matrixClient: MatrixClient): void {
        LogService.info("PointsPlugin", "Setting up points tracker");
        this.pointsTracker = new PointsTracker(matrixClient, this.config);

        LogService.info("PointsPlugin", "Registering command handler");
        CommandHandler.registerCommand("!points", this.pointsCommand.bind(this), "!points - Shows the current points standing");
        CommandHandler.registerCommand("!yay", this.yayCommand.bind(this), "!yay <user> <points> [task] - Awards points arbitrarily");
    }

    private async pointsCommand(_cmd: string, _args: string[], roomId: string, event, matrixClient: MatrixClient) {
        LogService.debug("PointsPlugin", "Sending current points standing to " + roomId);

        try {
            const points = this.pointsTracker.getCount();
            matrixClient.replyNotice(roomId, event, `Points: ${points}/${this.config.goal}`);
        } catch (e) {
            LogService.error("PointsPlugin", e);
            matrixClient.replyNotice(roomId, event, "Error processing command");
        }
    }

    private async yayCommand(_cmd: string, args: string[], roomId: string, event, matrixClient: MatrixClient) {
        if (this.admins.indexOf(event['sender']) === -1) {
            matrixClient.replyNotice(roomId, event, "You do not have permission to run that command");
            return;
        }

        if (args.length < 2) {
            matrixClient.replyNotice(roomId, event, "Not enough arguments. Try !yay <name> <amount> [reason]");
            return;
        }

        const user = args[0];
        const points = Number(args[1]);
        const reason = args.splice(2).join(" ").trim();

        LogService.debug("PointsPlugin", `Incrementing points by ${points} due to ${user} doing ${reason} - done by ${event['sender']}`);
        this.pointsTracker.incrementPoints(user, points, reason).then(() => {
            if (this.config.advertiseRoom !== roomId) {
                return this.pointsCommand(null, null, roomId, event, matrixClient);
            }
        }).catch(err => {
            LogService.error("PointsPlugin", err);
            matrixClient.replyNotice(roomId, event, "There was an error processing your command");
        });
    }
}

export interface PointsConfig {
    advertiseRoom: string;
    statsRoom: string;
    milestoneId: string;
    goal: number;
    widgetUrl: string;
    widgetName: string;
}