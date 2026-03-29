export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';
export interface ProcessedImage {
    base64: string;
    mediaType: string;
    format: ImageFormat;
    sizeBytes: number;
    dimensions?: {
        width: number;
        height: number;
    };
}
/** Detect image format from magic bytes. Returns null if unrecognized. */
export declare function detectImageFormat(data: Buffer): ImageFormat | null;
export declare function processImage(image: {
    data: Buffer;
    format: ImageFormat;
    size: number;
}): ProcessedImage;
