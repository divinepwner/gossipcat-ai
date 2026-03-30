/**
 * Relay Server
 *
 * Clean WebSocket server for routing messages between agents.
 * Auth via initial JSON frame, then MessagePack for all subsequent messages.
 */
export interface DashboardConfig {
    projectRoot: string;
    agentConfigs: Array<{
        id: string;
        provider: string;
        model: string;
        preset?: string;
        skills: string[];
        native?: boolean;
    }>;
}
export interface RelayServerConfig {
    port: number;
    host?: string;
    authTimeoutMs?: number;
    apiKey?: string;
    dashboard?: DashboardConfig;
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
    private dashboardAuth;
    private dashboardRouter;
    private dashboardWs;
    private dashboardUpgrader;
    constructor(config: RelayServerConfig);
    get port(): number;
    get url(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleConnection;
    private handleHttp;
    get dashboardKeyPrefix(): string;
    get dashboardUrl(): string;
    /** Call from handleConnection cleanup to keep relay count current */
    private updateDashboardConnectionCount;
}
