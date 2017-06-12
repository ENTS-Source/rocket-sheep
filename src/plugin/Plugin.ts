/**
 * Represents a plugin
 */
export interface Plugin {
    init(matrixClient): void;
}