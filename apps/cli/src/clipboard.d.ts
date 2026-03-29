import { ImageFormat } from './image-handler';
export type { ImageFormat } from './image-handler';
export interface ClipboardImage {
    data: Buffer;
    format: ImageFormat;
    size: number;
}
/** Read image from system clipboard. Returns null if no image. */
export declare function readClipboardImage(): Promise<ClipboardImage | null>;
