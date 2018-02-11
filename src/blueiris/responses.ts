export interface ClipListItem {
    camera: string;
    path: string;
    date: number; // seconds since epoch
    color: number; // 24bit RGB (red least significant)
    msec: number;
}