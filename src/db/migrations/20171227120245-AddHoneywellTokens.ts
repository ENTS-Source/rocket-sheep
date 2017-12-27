import { QueryInterface } from "sequelize";
import { DataType } from "sequelize-typescript";

export default {
    up: (queryInterface: QueryInterface) => {
        return queryInterface.createTable("honeywell_tokens", {
            "id": {type: DataType.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
            "accessToken": {type: DataType.STRING, allowNull: false},
            "refreshToken": {type: DataType.STRING, allowNull: false},
            "expirationTs": {type: DataType.INTEGER, allowNull: false},
        });
    },
    down: (queryInterface: QueryInterface) => {
        return queryInterface.dropTable("honeywell_tokens");
    }
}