"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserId = getUserId;
exports.normalizeGitUrl = normalizeGitUrl;
exports.getTeamUserId = getTeamUserId;
exports.getGitEmail = getGitEmail;
exports.getProjectId = getProjectId;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
function getOrCreateSalt(projectRoot) {
    const saltPath = (0, path_1.join)(projectRoot, '.gossip', 'local-salt');
    try {
        return (0, fs_1.readFileSync)(saltPath, 'utf-8').trim();
    }
    catch {
        // File doesn't exist — create atomically (wx flag fails if file already exists)
        const salt = (0, crypto_1.randomBytes)(16).toString('hex');
        (0, fs_1.mkdirSync)((0, path_1.join)(projectRoot, '.gossip'), { recursive: true });
        try {
            (0, fs_1.writeFileSync)(saltPath, salt, { flag: 'wx' });
            return salt;
        }
        catch {
            // Another process created it first — read theirs
            return (0, fs_1.readFileSync)(saltPath, 'utf-8').trim();
        }
    }
}
function getUserId(projectRoot) {
    try {
        const email = (0, child_process_1.execFileSync)('git', ['config', 'user.email'], { stdio: 'pipe' }).toString().trim();
        const salt = getOrCreateSalt(projectRoot);
        return (0, crypto_1.createHash)('sha256').update(email + projectRoot + salt).digest('hex').slice(0, 16);
    }
    catch {
        return 'anonymous';
    }
}
/** Normalize git remote URL to canonical form: hostname/owner/repo */
function normalizeGitUrl(url) {
    if (!url)
        return null;
    try {
        const withProtocol = url.replace(/^([^@]+@)?([^:\/]+):(?!\/)/, 'ssh://$2/');
        const parsed = new URL(withProtocol);
        const pathname = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
        return `${parsed.hostname}/${pathname}`;
    }
    catch {
        return url.replace(/^(https?:\/\/|git@|ssh:\/\/)/, '').replace(/\.git$/, '').replace(/:/g, '/');
    }
}
function getTeamUserId(email, teamSalt) {
    return (0, crypto_1.createHash)('sha256').update(email + teamSalt).digest('hex').slice(0, 16);
}
function getGitEmail() {
    try {
        const email = (0, child_process_1.execFileSync)('git', ['config', 'user.email'], { stdio: 'pipe' }).toString().trim();
        return email || null;
    }
    catch {
        return null;
    }
}
function getProjectId(projectRoot) {
    try {
        const remoteUrl = (0, child_process_1.execFileSync)('git', ['config', '--get', 'remote.origin.url'], { cwd: projectRoot, stdio: 'pipe' }).toString().trim();
        const normalized = normalizeGitUrl(remoteUrl);
        if (normalized) {
            return (0, crypto_1.createHash)('sha256').update(normalized).digest('hex').slice(0, 16);
        }
    }
    catch { /* no remote */ }
    return (0, crypto_1.createHash)('sha256').update(projectRoot).digest('hex').slice(0, 16);
}
//# sourceMappingURL=identity.js.map