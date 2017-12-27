import { PluginRegistry } from "./plugin/PluginRegistry";
import { CommandHandler } from "./matrix/CommandHandler";
import * as sdk from "matrix-js-sdk";
import * as config from "config";
import { LogService } from "matrix-js-snippets";

LogService.info("sheep", "Starting up...");

const registry = new PluginRegistry();

//noinspection TypeScriptValidateTypes
const client = sdk.createClient({
    baseUrl: config["matrix"]["homeserver"],
    accessToken: config["matrix"]["token"],
    userId: config["matrix"]["username"]
});

const commandHandler = new CommandHandler(client);

// Command processing handler
client.on("event", event => {
    if (event.getType() !== "m.room.message") return;
    if (event.getSender() === config["matrix"]["username"]) return;
    if (event.getContent().msgtype !== "m.text") return;

    commandHandler.process(event);
});

// Auto-join rooms
client.on("RoomMember.membership", (event, member) => {
    if (member.membership === 'invite' && member.userId === config["matrix"]["username"]) {
        LogService.info("sheep", "Invited to " + member.roomId + " by " + event.getSender());
        client.joinRoom(member.roomId).then(() => {
            LogService.info("sheep", "Joined room " + member.roomId);
        });
    }
});

client.on("sync", (state, oldState) => {
    LogService.verbose("sheep", "Sync state: " + oldState + " => " + state);
    if (state === "PREPARED") {
        registry.init(client);
    }
});

LogService.info("sheep", "Starting bot");
client.startClient();