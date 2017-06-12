import { Plugin } from "../Plugin";
import { LogService } from "../../util/LogService";

/**
 * Plugin for querying the door access records and announcing entry to the space.
 */
export class DoorPlugin implements Plugin {

    /**
     * Creates a new door plugin
     * @param config the config to use
     */
    constructor(private config: DoorConfig) {

    }

    public init(matrixClient): void {
        LogService.info("DoorPlugin", "Registering command handler");
        LogService.info("DoorPlugin", "Connecting to message queue");
    }
}

interface DoorConfig {
    announce_rooms: string[];
    announce_timeout: number;
    max_results: number;
    mq: {
        username: string;
        password: string;
        hostname: string;
        port: number;
        queue: string;
    };
}