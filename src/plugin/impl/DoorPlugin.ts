import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
//noinspection TypeScriptCheckImport
import * as amqp from "amqplib/callback_api";
import { CommandHandler } from "../../matrix/CommandHandler";
import * as _ from "lodash";
import moment = require("moment");

/**
 * Plugin for querying the door access records and announcing entry to the space.
 */
export class DoorPlugin implements Plugin {

    private enterRecords: EntranceRecord[] = [];
    private matrixClient: any;
    private startTime = moment();

    /**
     * Creates a new door plugin
     * @param config the config to use
     */
    constructor(private config: DoorConfig) {

    }

    public init(matrixClient): void {
        this.matrixClient = matrixClient;

        LogService.info("DoorPlugin", "Registering command handler");
        CommandHandler.registerCommand("!door last", this.doorLastCommand.bind(this), "!door last [number] - Gets the most recent [number] entries to the space.");

        LogService.info("DoorPlugin", "Connecting to message queue");
        this.connectMq();
    }

    private doorLastCommand(cmd: string, args: string[], roomId: string, sender: string, matrixClient: any): void {
        let numRecent = args.length > 0 ? Number(args[0]) : 1;
        if (_.isNaN(numRecent)) numRecent = 1;
        LogService.verbose("DoorPlugin", "Last " + numRecent + " unlocks requested of " + this.enterRecords.length + " available in room " + roomId);
        if (this.enterRecords.length === 0) {
            matrixClient.sendNotice(roomId, "No recent entries.");
            return;
        }

        numRecent = Math.max(1, Math.min(numRecent, this.enterRecords.length));
        LogService.verbose("DoorPlugin", "Displaying " + numRecent + " most recent unlocks to room " + roomId);

        let records = [];
        for (let i = 0; i < numRecent; i++) {
            records.push(this.enterRecords[this.enterRecords.length - i - 1]);
        }

        let messsage = (records.length > 1 ? "Showing " + numRecent + " most recent entries:\n" : "") + records.map(r => r.displayName + "     " + r.time.fromNow()).join("\n");
        matrixClient.sendNotice(roomId, messsage);
    }

    private rotateMemory(): void {
        if (this.enterRecords.length > this.config.max_results) {
            LogService.silly("DoorPlugin", "Shrinking in-memory history from " + this.enterRecords.length + " to " + this.config.max_results);
            this.enterRecords = this.enterRecords.reverse().splice(0, this.config.max_results).reverse();
        }
    }

    private processUnlockAttempt(event: UnlockAttemptEvent): void {
        if (!event.permitted) return; // don't even record it

        var newRecord: EntranceRecord = {
            fobNumber: event.fobNumber,
            displayName: event.name,
            announced: event.announce,
            time: moment()
        };

        if (event.announce) {
            let mostRecentEntrace: EntranceRecord;
            for (let record of this.enterRecords) {
                if (record.fobNumber !== newRecord.fobNumber || !record.announced) continue;
                mostRecentEntrace = record;
            }

            if (!mostRecentEntrace || moment.duration(newRecord.time.diff(mostRecentEntrace.time)).asSeconds() >= this.config.announce_timeout) {
                LogService.info("DoorPlugin", "Announcing entrance of " + newRecord.fobNumber + " to rooms");
                for (let roomId of this.config.announce_rooms) {
                    LogService.verbose("DoorPlugin", "Sending announce for " + newRecord.fobNumber + " to " + roomId);
                    this.matrixClient.sendNotice(roomId, newRecord.displayName + " entered the space");
                }
            } else LogService.verbose("DoorPlugin", "Skipping announce for " + newRecord.fobNumber + ": Recent unlock");
        }

        this.enterRecords.push(newRecord);
        this.rotateMemory();
    }

    private connectMq(): void {
        let connectionString = "amqp://" + this.config.mq.username + ":" + this.config.mq.password + "@" + this.config.mq.hostname + ":" + this.config.mq.port;
        amqp.connect(connectionString, (err, conn) => {
            if (err) throw new Error(err);
            LogService.verbose("DoorPlugin", "Connected to MQ");

            conn.createChannel((err, ch) => {
                if (err) throw new Error(err);
                LogService.verbose("DoorPlugin", "MQ channel created");

                ch.consume(this.config.mq.queue, (msg) => {
                    let body = JSON.parse(msg.content.toString());
                    LogService.verbose("DoorPlugin", "Received message: " + JSON.stringify(body));

                    if (moment.duration(moment().diff(this.startTime)).asSeconds() <= 15) {
                        LogService.warn("DoorPlugin", "Skipping MQ message because we recently started up: " + JSON.stringify(body));
                        return;
                    }

                    if (body["type"] === "UNLOCK_ATTEMPT") {
                        this.processUnlockAttempt(body);
                    }
                }, {noAck: true});
            });

            conn.on('close', () => {
                LogService.warn("DoorPlugin", "MQ lost connection - reconnecting");
                this.connectMq();
            })
        });
    }
}

interface UnlockAttemptEvent {
    type: string;
    permitted: boolean;
    fobNumber: string;
    name: string;
    announce: boolean;
}

interface EntranceRecord {
    fobNumber: string;
    displayName: string;
    announced: boolean;
    time: any;
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