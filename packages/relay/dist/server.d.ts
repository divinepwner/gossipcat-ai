/**
 * Relay Server
 *
 * Clean WebSocket server for routing messages between agents.
 * Auth via initial JSON frame, then MessagePack for all subsequent messages.
 */
export interface RelayServerConfig {
    port: number;
    host?: string;
    authTimeoutMs?: number;
    apiKey?: string;
}
export declare class RelayServer {
    private config;
    private wss;
    private httpServer;
    private connectionManager;
    private router;
    private codec;
    private _port;
    private authTimeoutMs;
    private connectionsByIp;
    private readonly maxConnectionsPerIp;
    private readonly maxTotalConnections;
    constructor(config: RelayServerConfig);
    get port(): number;
    get url(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleConnection;
    private handleHttp;
}
