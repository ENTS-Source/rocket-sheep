import * as _ from "lodash";
import config from "../config";
import { LogService, MatrixClient } from "matrix-bot-sdk";

/**
 * Processes commands, finding appropriate plugins to handle them.
 */
export class CommandHandler {

    private static prefixMap: { [prefix: string]: { handler: CommandHandlerFn, helpText: string } } = {};

    /**
     * Creates a new command handler
     * @param {MatrixClient} matrixClient the matrix client to drive responses
     */
    constructor(private matrixClient: MatrixClient) {

    }

    /**
     * Processes a matrix event. Must be an m.room.message not directed at the bot with a message type of m.text
     * @param {string} roomId the room ID the event happened in
     * @param {*} event the event to process
     */
    public process(roomId: string, event): void {
        let keys = _.keys(CommandHandler.prefixMap);
        let message = event['content']['body'].trim();
        LogService.debug("CommandHandler", "Processing command " + message);

        if (message.toLowerCase() === "!help" && keys.length > 0) {
            LogService.debug("CommandHandler", "Intercepting help command for room " + roomId);
            this.sendHelp(roomId, event);
            return;
        }

        for (let key of keys) {
            if (message.toLowerCase().startsWith(key.toLowerCase())) {
                LogService.debug("CommandHandler", "Command matches prefix '" + key + "': " + message);

                if (!this.canRunCommand(event['sender'], roomId)) {
                    LogService.debug("CommandHandler", "Denying " + event['sender'] + " in room " + roomId + " from using command " + message);
                    this.matrixClient.replyNotice(roomId, event, "Sorry, you do not have permission to use that command here");
                    return;
                }

                let args = message.substring(key.length).trim().split(' ');
                CommandHandler.prefixMap[key].handler(key, args, roomId, event, this.matrixClient);
            }
        }
        LogService.debug("CommandHandler", "Done processing command " + message);
    }

    /**
     * Registers a command with the handler
     * @param prefix the prefix to use. Eg: "!camera list"
     * @param handler the handler for the command
     * @param helpText the text to show in the help menu
     */
    public static registerCommand(prefix: string, handler: CommandHandlerFn, helpText: string): void {
        LogService.info("CommandHandler", "Registered command prefix " + prefix);
        CommandHandler.prefixMap[prefix] = {handler: handler, helpText: helpText};
    }

    private isPublicRoom(roomId: string): boolean {
        return config.public_rooms.indexOf(roomId) !== -1;
    }

    private isAdmin(sender: string): boolean {
        return config.admins.indexOf(sender) !== -1;
    }

    private canRunCommand(sender: string, roomId: string): boolean {
        return this.isAdmin(sender) || this.isPublicRoom(roomId);
    }

    private sendHelp(roomId: string, event): void {
        let message = "Commands:\n";
        for (let key in CommandHandler.prefixMap) {
            message += CommandHandler.prefixMap[key].helpText + "\n";
        }
        this.matrixClient.replyNotice(roomId, event, message);
    }
}

/**
 * Represents a command handler
 */
export interface CommandHandlerFn {
    /**
     * Handles the command
     * @param command the command prefix
     * @param args the arguments (separated by space)
     * @param roomId the room ID
     * @param event the event
     * @param matrixClient the client
     */
    (command: string, args: string[], roomId: string, event, matrixClient: MatrixClient): void;
}
