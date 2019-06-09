import { Plugin } from "../Plugin";
import { CommandHandler } from "../../matrix/CommandHandler";
import { LogService, MatrixClient } from "matrix-bot-sdk";

/**
 * Plugin for listing the directors.
 */
export class DirectorsPlugin implements Plugin {

    /**
     * Creates a new directors plugin
     * @param config the config to use
     */
    constructor(private config: DirectorsConfig) {
    }

    public init(): void {
        LogService.info("DirectorsPlugin", "Registering command handler");
        CommandHandler.registerCommand("!directors", this.directorsCommand.bind(this), "!directors - Lists all of the directors");
    }

    private directorsCommand(_cmd: string, _args: string[], roomId: string, event, matrixClient: MatrixClient): void {
        let message = this.config.directors.join("\n") + "\n\nContact us at " + this.config.contact_email;
        matrixClient.replyNotice(roomId, event, message, message.replace(/\n/g, '<br/>'));
    }
}

interface DirectorsConfig {
    directors: string[];
    contact_email: string;
}