import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";

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

    private directorsCommand(_cmd: string, _args: string[], roomId: string, _sender: string, matrixClient: any): void {
        let message = this.config.directors.join("\n") + "\n\nContact us at " + this.config.contact_email;
        matrixClient.sendNotice(roomId, message);
    }
}

interface DirectorsConfig {
    directors: string[];
    contact_email: string;
}