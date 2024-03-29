import { Plugin } from "./Plugin";
import { CameraPlugin } from "./impl/CameraPlugin";
import { DirectorsPlugin } from "./impl/DirectorsPlugin";
import config from "../config";
import { ActivityPlugin } from "./impl/ActivityPlugin";
import { EmoncmsPlugin } from "./impl/EmoncmsPlugin";
import { AMemberPlugin } from "./impl/AMemberPlugin";
import { PointsPlugin } from "./impl/PointsPlugin";
import { LogService } from "matrix-bot-sdk";

/**
 * Holds information about the various enabled plugins
 */
export class PluginRegistry {

    private plugins: Plugin[] = [];

    /**
     * Creates a new plugin registry. This will cause a scan for plugins and run their pre-init routines.
     */
    constructor() {
        if (config.cameras.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'cameras' to plugin list.");
            this.plugins.push(new CameraPlugin(config.cameras, config.admins));
        }
        if (config.directors.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'directors' to plugin list.");
            this.plugins.push(new DirectorsPlugin(config.directors));
        }
        if (config.activity.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'activity' to plugin list.");
            this.plugins.push(new ActivityPlugin(config.cameras, config.admins, config.web.port));
        }
        if (config.emoncms.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'emoncms' to plugin list.");
            this.plugins.push(new EmoncmsPlugin(config.emoncms));
        }
        if (config.amember.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'amember' to plugin list.");
            this.plugins.push(new AMemberPlugin(config.amember, config.admins, config.web.port));
        }
        if (config.points.enabled) {
            LogService.info("PluginRegistry", "Adding enabled plugin 'points' to plugin list.");
            this.plugins.push(new PointsPlugin(config.points, config.admins));
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
