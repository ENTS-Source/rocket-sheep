import { LogService } from "./util/LogService";
import { PluginRegistry } from "./plugin/PluginRegistry";
import { CommandHandler } from "./matrix/CommandHandler";
import * as sdk from "matrix-js-sdk";
import * as config from "config";

LogService.info("sheep", "Starting up...");

const registry = new PluginRegistry();

//noinspection TypeScriptValidateTypes
const client = sdk.createClient({
    baseUrl: config["matrix"]["homeserver"],
    accessToken: config["matrix"]["token"],
    userId: config["matrix"]["username"]
});

const commandHandler = new CommandHandler(client);

client.on("event", event => {
    if (event.getType() !== "m.room.message") return;
    if (event.getSender() === config["matrix"]["username"]) return;
    if (event.getContent().msgtype !== "m.text") return;

    commandHandler.process(event);
});

client.on("sync", (state, oldState) => {
    LogService.verbose("sheep", "Sync state: " + oldState + " => " + state);
    if (state === "PREPARED") {
        registry.init(client);
    }
});

LogService.info("sheep", "Starting bot");
client.startClient();