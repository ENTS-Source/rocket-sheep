import * as config from "config";
import { LogConfig } from "matrix-js-snippets";

export interface SheepConfig {
    matrix: {
        homeserver: string;
        token: string;
        username: string;
    };
    admins: string[];
    public_rooms: string[];
    web: {
        externalUrl: string;
        bind: string;
        port: number;
    };
    database: {
        file: string;
    };
    activity: {
        enabled: boolean;
    };
    emoncms: {
        enabled: boolean;
        apiKey: string;
        feeds: { kwhId: string, name: string }[];
        apiUrl: string;
    };
    honeywell: {
        enabled: boolean;
        consumer_key: string;
        consumer_secret: string;
        alternative_names: {
            current_name: string;
            display_name: string;
        }[];
    };
    doors: {
        enabled: boolean;
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
    };
    directors: {
        enabled: boolean;
        directors: string[];
        contact_email: string;
    };
    cameras: {
        enabled: boolean;
        api: {
            username: string;
            password: string;
            base_url: string;
        };
        mappings: {
            id: string;
            description: string;
            aliases: string[];
            area: string;
        }[];
    }
    logging: LogConfig;
}

export default <SheepConfig>config;