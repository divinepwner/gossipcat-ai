"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readClipboardImage = readClipboardImage;
const child_process_1 = require("child_process");
const util_1 = require("util");
const image_handler_1 = require("./image-handler");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Read image from system clipboard. Returns null if no image. */
async function readClipboardImage() {
    const platform = process.platform;
    try {
        if (platform === 'darwin')
            return await readMacOS();
        if (platform === 'linux')
            return await readLinux();
        if (platform === 'win32')
            return await readWindows();
        throw new Error(`Unsupported platform: ${platform}`);
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('not found') || msg.includes('ENOENT')) {
            if (platform === 'linux')
                throw new Error('xclip is not installed. Install it with: sudo apt install xclip');
            if (platform === 'darwin')
                throw new Error('pngpaste is not installed. Install it with: brew install pngpaste');
        }
        return null;
    }
}
async function readMacOS() {
    try {
        const { stdout } = await execFileAsync('pngpaste', ['-'], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });
        if (!stdout || stdout.length === 0)
            return null;
        const buf = stdout;
        const format = (0, image_handler_1.detectImageFormat)(buf);
        if (!format)
            return null;
        return { data: buf, format, size: buf.length };
    }
    catch {
        return null;
    }
}
async function readLinux() {
    const mimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    for (const mime of mimeTypes) {
        try {
            const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-t', mime, '-o'], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });
            if (stdout && stdout.length > 0) {
                const buf = stdout;
                const format = (0, image_handler_1.detectImageFormat)(buf);
                if (format)
                    return { data: buf, format, size: buf.length };
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
async function readWindows() {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }`;
    const { stdout } = await execFileAsync('powershell', ['-command', script], { maxBuffer: 50 * 1024 * 1024 });
    if (!stdout || stdout.trim().length === 0)
        return null;
    const data = Buffer.from(stdout.trim(), 'base64');
    const format = (0, image_handler_1.detectImageFormat)(data);
    if (!format)
        return null;
    return { data, format, size: data.length };
}
//# sourceMappingURL=clipboard.js.map