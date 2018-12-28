import { Plugin } from "./Plugin";
import { DoorPlugin } from "./impl/DoorPlugin";
import { CameraPlugin } from "./impl/CameraPlugin";
import { LogService } from "matrix-js-snippets";
import { DirectorsPlugin } from "./impl/DirectorsPlugin";
import config from "../config";
import { HoneywellPlugin } from "./impl/HoneywellPlugin";
import { ActivityPlugin } from "./impl/ActivityPlugin";
import { EmoncmsPlugin } from "./impl/EmoncmsPlugin";
import { AMemberPlugin } from "./impl/AMemberPlugin";

/**
 * Holds information about the various enabled plugins
 */
export class PluginRegistry {

    private plugins: Plugin[] = [];

    /**
     * Creates a new plugin registry. This will cause a scan for plugins and run their pre-init routines.
     */
    constructor() {
        if (config.doors.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'doors' to plugin list.");
            this.plugins.push(new DoorPlugin(config.doors));
        }
        if (config.cameras.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'cameras' to plugin list.");
            this.plugins.push(new CameraPlugin(config.cameras, config.admins));
        }
        if (config.directors.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'directors' to plugin list.");
            this.plugins.push(new DirectorsPlugin(config.directors));
        }
        if (config.honeywell.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'honeywell' to plugin list.");
            this.plugins.push(new HoneywellPlugin(config.honeywell));
        }
        if (config.activity.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'activity' to plugin list.");
            this.plugins.push(new ActivityPlugin(config.cameras));
        }
        if (config.emoncms.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'emoncms' to plugin list.");
            this.plugins.push(new EmoncmsPlugin(config.emoncms));
        }
        if (config.amember.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'amember' to plugin list.");
            this.plugins.push(new AMemberPlugin(config.amember, config.admins, config.web.port));
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