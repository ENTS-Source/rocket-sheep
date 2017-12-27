import { AutoIncrement, Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "honeywell_tokens",
    underscoredAll: false,
    timestamps: false,
})
export default class HoneywellToken extends Model<HoneywellToken> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @Column
    accessToken: string;

    @Column
    refreshToken: string;

    @Column
    expirationTs: number;
}