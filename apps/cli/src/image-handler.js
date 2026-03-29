"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectImageFormat = detectImageFormat;
exports.processImage = processImage;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
const MEDIA_TYPES = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};
/** Detect image format from magic bytes. Returns null if unrecognized. */
function detectImageFormat(data) {
    if (data.length < 4)
        return null;
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47)
        return 'png';
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF)
        return 'jpeg';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38)
        return 'gif';
    if (data.length >= 12 &&
        data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50)
        return 'webp';
    return null;
}
function extractDimensions(data, format) {
    if (format === 'png' && data.length >= 24) {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (format === 'gif' && data.length >= 10) {
        return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    }
    return undefined;
}
function processImage(image) {
    if (image.size > MAX_IMAGE_SIZE) {
        throw new Error(`Image exceeds 20 MB limit (${Math.round(image.size / 1024 / 1024)} MB). Resize before pasting.`);
    }
    return {
        base64: image.data.toString('base64'),
        mediaType: MEDIA_TYPES[image.format],
        format: image.format,
        sizeBytes: image.size,
        dimensions: extractDimensions(image.data, image.format),
    };
}
//# sourceMappingURL=image-handler.js.map