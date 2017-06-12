import { LogService } from "../util/LogService";
/**
 * Processes commands, finding appropriate plugins to handle them.
 */
export class CommandHandler {

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
        LogService.error("CommandHandler", "Processing not implemented: " + event.getContent().message);
    }

}