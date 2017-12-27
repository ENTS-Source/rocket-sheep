import { Model, Sequelize } from "sequelize-typescript";
import config from "../config";
import { LogService } from "matrix-js-snippets";
import * as Promise from "bluebird";
import * as path from "path";
import * as Umzug from "umzug";
import HoneywellToken from "./models/HoneywellToken";

class _SheepStore {
    private sequelize: Sequelize;

    constructor() {
        this.sequelize = new Sequelize({
            dialect: 'sqlite',
            database: "rocketsheep",
            storage: config.database.file,
            username: "",
            password: "",
            logging: i => LogService.verbose("SheepStore [SQL]", i)
        });
        this.sequelize.addModels(<Array<typeof Model>>[
            HoneywellToken,
        ]);
    }

    public updateSchema(): Promise<any> {
        LogService.info("SheepStore", "Updating schema...");

        const migrator = new Umzug({
            storage: "sequelize",
            storageOptions: {sequelize: this.sequelize},
            migrations: {
                params: [this.sequelize.getQueryInterface()],
                path: path.join(__dirname, "migrations"),
            }
        });

        return migrator.up();
    }
}

export const SheepStore = new _SheepStore();

export function resolveIfExists<T>(record: T): Promise<T> {
    if (!record) return Promise.reject("Record not found");
    return Promise.resolve(record);
}