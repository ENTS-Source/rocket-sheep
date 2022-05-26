import { PluginRegistry } from "./plugin/PluginRegistry";
import { CommandHandler } from "./matrix/CommandHandler";
import config from "./config";
import Webserver from "./api/Webserver";
import { AutojoinRoomsMixin, LogService, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";

LogService.info("sheep", "Starting up...");

(async function() {
    new Webserver().start();

    const registry = new PluginRegistry();

    const storage = new SimpleFsStorageProvider(config.matrix.storagePath);
    const client = new MatrixClient(config.matrix.homeserver, config.matrix.token, storage);
    AutojoinRoomsMixin.setupOnClient(client);

    const commandHandler = new CommandHandler(client);

    // Command processing handler
    client.on("room.message", async (roomId, event) => {
        if (event['type'] !== "m.room.message" || !event['content']) return;
        if (event['sender'] === await client.getUserId()) return;
        if (!event['content']['body']) return;
        if (event['content']['msgtype'] !== "m.text") return;

        commandHandler.process(roomId, event);
    });

    LogService.info("sheep", "Starting bot");
    client.start().then(() => registry.init(client));
})();
