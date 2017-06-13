import * as config from "config";
import { Plugin } from "./Plugin";
import { DoorPlugin } from "./doors/DoorPlugin";
import { CameraPlugin } from "./cameras/CameraPlugin";
import { LogService } from "../util/LogService";

/**
 * Holds information about the various enabled plugins
 */
export class PluginRegistry {

    private plugins: Plugin[] = [];

    /**
     * Creates a new plugin registry. This will cause a scan for plugins and run their pre-init routines.
     */
    constructor() {
        if (config["doors"]["enabled"]) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'doors' to plugin list.");
            this.plugins.push(new DoorPlugin(config["doors"]));
        }
        if (config["cameras"]["enabled"]) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'cameras' to plugin list.");
            this.plugins.push(new CameraPlugin(config["cameras"]));
        }

        LogService.info("PluginRegistry", "Found " + this.plugins.length + " enabled plugins");
    }

    /**
     * Runs the initialization routine on all plugins, starting them.
     * @param matrixClient the matrix client being used
     */
    init(matrixClient): void {
        for (let plugin of this.plugins) {
            plugin.init(matrixClient);
        }
    }
}