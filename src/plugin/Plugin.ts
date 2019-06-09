import { MatrixClient } from "matrix-bot-sdk";

/**
 * Represents a plugin
 */
export interface Plugin {
    init(matrixClient: MatrixClient): void;
}