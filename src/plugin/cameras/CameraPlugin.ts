import { Plugin } from "../Plugin";
import { LogService } from "../../util/LogService";
import { CommandHandler } from "../../matrix/CommandHandler";

/**
 * Plugin for querying the the space's cameras.
 */
export class CameraPlugin implements Plugin {

    /**
     * Creates a new camera plugin
     * @param config the config to use
     */
    constructor(private config: CameraConfig) {

    }

    public init(matrixClient): void {
        LogService.info("CameraPlugin", "Registering command handler");
        CommandHandler.registerCommand("!camera list", this.cameraListCommand.bind(this));
        CommandHandler.registerCommand("!camera show", this.cameraShowCommand.bind(this));
    }

    private cameraListCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        LogService.verbose("CameraPlugin", "Sending camera list to room " + roomId);
        let lines = this.config.mappings.map(c => c.id.toLowerCase() + " - " + c.description);
        let msg = lines.join("\n");
        matrixClient.sendNotice(roomId, msg + "\n\nUse !camera show <camera name> to see the camera");
    }

    private cameraShowCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        matrixClient.sendNotice(roomId, "NYI");
    }
}

interface CameraConfig {
    api: {
        username: string;
        password: string;
        base_url: string;
    };
    mappings: {
        id: string;
        description: string;
        aliases: string[];
    }[];
}