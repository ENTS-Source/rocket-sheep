import { LogService } from "matrix-js-snippets";
import * as _ from "lodash";
import config from "../config";

/**
 * Processes commands, finding appropriate plugins to handle them.
 */
export class CommandHandler {

    private static prefixMap: { [prefix: string]: { handler: CommandHandlerFn, helpText: string } } = {};

    /**
     * Creates a new command handler
     * @param matrixClient the matrix client to drive responses
     */
    constructor(private matrixClient) {

    }

    /**
     * Processes a matrix event. Must be an m.room.message not directed at the bot with a message type of m.text
     * @param event the event to process
     */
    public process(event): void {
        let keys = _.keys(CommandHandler.prefixMap);
        let message = event.getContent().body.trim();
        LogService.verbose("CommandHandler", "Processing command " + message);

        if (message.toLowerCase() === "!help" && keys.length > 0) {
            LogService.verbose("CommandHandler", "Intercepting help command for room " + event.getRoomId());
            this.sendHelp(event.getRoomId());
            return;
        }

        for (let key of keys) {
            if (message.toLowerCase().startsWith(key.toLowerCase())) {
                LogService.verbose("CommandHandler", "Command matches prefix '" + key + "': " + message);

                if (!this.canRunCommand(event.getSender(), event.getRoomId())) {
                    LogService.verbose("CommandHandler", "Denying " + event.getSender() + " in room " + event.getRoomId() + " from using command " + message);
                    this.matrixClient.sendNotice(event.getRoomId(), "Sorry, you don't have permission to use that command here.");
                    return;
                }

                let args = message.substring(key.length).trim().split(' ');
                CommandHandler.prefixMap[key].handler(key, args, event.getRoomId(), event.getSender(), this.matrixClient);
            }
        }
        LogService.verbose("CommandHandler", "Done processing command " + message);
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

    private sendHelp(roomId: string): void {
        let message = "Commands:\n";
        for (let key in CommandHandler.prefixMap) {
            message += CommandHandler.prefixMap[key].helpText + "\n";
        }
        this.matrixClient.sendNotice(roomId, message);
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
     * @param sender the sender
     * @param matrixClient the client
     */
    (command: string, args: string[], roomId: string, sender: string, matrixClient: any): void;
}
