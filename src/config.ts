import * as config from "config";

export interface SheepConfig {
    matrix: {
        homeserver: string;
        token: string;
        storagePath: string;
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
        kwh: {
            feedIds: string[];
            intervalSeconds: number;
            minDeltaPerInterval: number;
            minSecondsBeforeRise: number;
            minSecondsBeforeFall: number;
            notifications: {
                enabled: boolean;
                roomId: string;
                riseMessage: string;
                fallMessage: string;
            };
        };
        apiUrl: string;
    };
    amember: {
        enabled: boolean;
        apiKey: string;
        url: string;
        activeMemberCategory: string;
        interestedCategories: string[];
    };
    points: {
        enabled: boolean;
        advertiseRoom: string;
        statsRoom: string;
        milestoneId: string;
        goal: number;
        widgetUrl: string;
        widgetName: string;
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
        homeAssistant: {
            enabled: boolean;
            address: string;
            token: string;
            fontPath: string;
            airQuality: {
                cameraId: string;
                deviceId: string;
            }[];
        };
    };
}

export default <SheepConfig>config;
