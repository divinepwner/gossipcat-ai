"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Keychain = void 0;
const child_process_1 = require("child_process");
const os_1 = require("os");
const SERVICE_NAME = 'gossip-mesh';
const VALID_PROVIDERS = /^[a-zA-Z0-9_-]{1,32}$/;
class Keychain {
    inMemoryStore = new Map();
    useKeychain;
    constructor() {
        this.useKeychain = this.isKeychainAvailable();
        if (!this.useKeychain) {
            console.warn('[Keychain] OS keychain not available. Keys stored in memory only (not persisted).');
        }
    }
    async getKey(provider) {
        if (this.useKeychain) {
            try {
                return this.readFromKeychain(provider);
            }
            catch {
                return this.inMemoryStore.get(provider) || null;
            }
        }
        return this.inMemoryStore.get(provider) || null;
    }
    async setKey(provider, key) {
        this.inMemoryStore.set(provider, key);
        if (this.useKeychain) {
            try {
                this.writeToKeychain(provider, key);
            }
            catch {
                console.warn(`[Keychain] Failed to write to OS keychain. Key for ${provider} stored in memory only.`);
            }
        }
    }
    isKeychainAvailable() {
        if ((0, os_1.platform)() === 'darwin') {
            try {
                (0, child_process_1.execFileSync)('security', ['help'], { stdio: 'pipe' });
                return true;
            }
            catch {
                return false;
            }
        }
        if ((0, os_1.platform)() === 'linux') {
            try {
                (0, child_process_1.execFileSync)('which', ['secret-tool'], { stdio: 'pipe' });
                return true;
            }
            catch {
                return false;
            }
        }
        return false;
    }
    validateProvider(provider) {
        if (!VALID_PROVIDERS.test(provider)) {
            throw new Error(`Invalid provider name: "${provider}"`);
        }
    }
    readFromKeychain(provider) {
        this.validateProvider(provider);
        if ((0, os_1.platform)() === 'darwin') {
            return (0, child_process_1.execFileSync)('security', [
                'find-generic-password', '-s', SERVICE_NAME, '-a', provider, '-w'
            ], { stdio: 'pipe' }).toString().trim();
        }
        if ((0, os_1.platform)() === 'linux') {
            return (0, child_process_1.execFileSync)('secret-tool', [
                'lookup', 'service', SERVICE_NAME, 'provider', provider
            ], { stdio: 'pipe' }).toString().trim();
        }
        throw new Error('Unsupported platform');
    }
    writeToKeychain(provider, key) {
        this.validateProvider(provider);
        if ((0, os_1.platform)() === 'darwin') {
            try {
                (0, child_process_1.execFileSync)('security', [
                    'delete-generic-password', '-s', SERVICE_NAME, '-a', provider
                ], { stdio: 'pipe' });
            }
            catch { /* doesn't exist yet */ }
            (0, child_process_1.execFileSync)('security', [
                'add-generic-password', '-s', SERVICE_NAME, '-a', provider, '-w', key
            ], { stdio: 'pipe' });
            return;
        }
        if ((0, os_1.platform)() === 'linux') {
            (0, child_process_1.execFileSync)('secret-tool', [
                'store', '--label', `Gossip Mesh ${provider}`, 'service', SERVICE_NAME, 'provider', provider
            ], { input: key, stdio: ['pipe', 'pipe', 'pipe'] });
            return;
        }
    }
}
exports.Keychain = Keychain;
//# sourceMappingURL=keychain.js.map