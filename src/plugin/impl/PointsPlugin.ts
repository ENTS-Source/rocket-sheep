import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import { PointsTracker } from "../../points/PointsTracker";

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

    public init(matrixClient): void {
        LogService.info("PointsPlugin", "Setting up points tracker");
        this.pointsTracker = new PointsTracker(matrixClient, this.config);

        LogService.info("PointsPlugin", "Registering command handler");
        CommandHandler.registerCommand("!points", this.pointsCommand.bind(this), "!points - Shows the current points standing");
        CommandHandler.registerCommand("!yay", this.yayCommand.bind(this), "!yay <user> <points> [task] - Awards points arbitrarily");
    }

    private async pointsCommand(_cmd: string, _args: string[], roomId: string, _sender: string, matrixClient: any) {
        LogService.verbose("PointsPlugin", "Sending current points standing to " + roomId);

        try {
            const points = this.pointsTracker.getCount();
            matrixClient.sendNotice(roomId, `Points: ${points}/${this.config.goal}`);
        } catch (e) {
            LogService.error("PointsPlugin", e);
            matrixClient.sendNotice(roomId, "Error processing command");
        }
    }

    private async yayCommand(_cmd: string, args: string[], roomId: string, sender: string, matrixClient: any) {
        if (this.admins.indexOf(sender) === -1) {
            matrixClient.sendNotice(roomId, "You do not have permission to run that command");
            return;
        }

        if (args.length < 2) {
            matrixClient.sendNotice(roomId, "Not enough arguments. Try !yay <name> <amount> [reason]");
            return;
        }

        const user = args[0];
        const points = Number(args[1]);
        const reason = args.splice(2).join(" ").trim();

        LogService.verbose("PointsPlugin", `Incrementing points by ${points} due to ${user} doing ${reason} - done by ${sender}`);
        this.pointsTracker.incrementPoints(user, points, reason).then(() => {
            if (this.config.advertiseRoom !== roomId) {
                return this.pointsCommand(null, null, roomId, null, matrixClient);
            }
        }).catch(err => {
            LogService.error("PointsPlugin", err);
            return matrixClient.sendNotice(roomId, "There was an error processing your command");
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