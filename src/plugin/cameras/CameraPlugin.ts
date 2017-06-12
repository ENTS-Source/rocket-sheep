import { Plugin } from "../Plugin";
import { LogService } from "../../util/LogService";

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