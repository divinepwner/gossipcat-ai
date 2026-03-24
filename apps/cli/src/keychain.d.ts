export declare class Keychain {
    private inMemoryStore;
    private useKeychain;
    constructor();
    getKey(provider: string): Promise<string | null>;
    setKey(provider: string, key: string): Promise<void>;
    private isKeychainAvailable;
    private validateProvider;
    private readFromKeychain;
    private writeToKeychain;
}
