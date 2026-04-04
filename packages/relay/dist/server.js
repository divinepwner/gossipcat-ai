"use strict";
/**
 * Relay Server
 *
 * Clean WebSocket server for routing messages between agents.
 * Auth via initial JSON frame, then MessagePack for all subsequent messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayServer = void 0;
const ws_1 = require("ws");
const http_1 = require("http");
const crypto_1 = require("crypto");
const types_1 = require("@gossip/types");
const connection_manager_1 = require("./connection-manager");
const router_1 = require("./router");
const agent_connection_1 = require("./agent-connection");
const auth_1 = require("./dashboard/auth");
const routes_1 = require("./dashboard/routes");
const ws_2 = require("./dashboard/ws");
class RelayServer {
    config;
    wss;
    httpServer;
    connectionManager;
    router;
    codec = new types_1.Codec();
    _port = 0;
    authTimeoutMs;
    connectionsByIp = new Map();
    maxConnectionsPerIp = 10;
    maxTotalConnections = 500;
    dashboardAuth = null;
    dashboardRouter = null;
    dashboardWs = null;
    dashboardUpgrader = null; // single instance — avoids per-request leak
    constructor(config) {
        this.config = config;
        this.connectionManager = new connection_manager_1.ConnectionManager();
        this.router = new router_1.MessageRouter(this.connectionManager);
        this.authTimeoutMs = config.authTimeoutMs ?? 5000;
    }
    get port() { return this._port; }
    get url() { return `ws://localhost:${this._port}`; }
    async start() {
        return new Promise((resolve) => {
            this.httpServer = (0, http_1.createServer)(this.handleHttp.bind(this));
            if (this.config.dashboard) {
                this.dashboardAuth = new auth_1.DashboardAuth();
                this.dashboardAuth.init();
                this.dashboardWs = new ws_2.DashboardWs();
                this.dashboardUpgrader = new ws_1.WebSocketServer({ noServer: true });
                this.dashboardRouter = new routes_1.DashboardRouter(this.dashboardAuth, this.config.dashboard.projectRoot, {
                    agentConfigs: this.config.dashboard.agentConfigs,
                    relayConnections: this.connectionManager.count,
                    connectedAgentIds: this.connectionManager.getAll().map(c => c.agentId),
                });
            }
            this.wss = new ws_1.WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 });
            this.wss.on('connection', this.handleConnection.bind(this));
            this.httpServer.on('upgrade', (req, socket, head) => {
                const url = req.url ?? '';
                if (url === '/dashboard/ws' && this.dashboardWs && this.dashboardUpgrader) {
                    // Dashboard WebSocket — validate session cookie before accepting
                    const cookie = req.headers.cookie ?? '';
                    const match = cookie.match(/dashboard_session=([^;]+)/);
                    const token = match ? match[1] : null;
                    if (!token || !this.dashboardAuth?.validateSession(token)) {
                        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                        socket.destroy();
                        return;
                    }
                    this.dashboardUpgrader.handleUpgrade(req, socket, head, (ws) => {
                        this.dashboardWs.addClient(ws);
                        ws.on('close', () => this.dashboardWs.removeClient(ws));
                        ws.on('error', () => this.dashboardWs.removeClient(ws));
                    });
                }
                else {
                    // Agent WebSocket — existing logic
                    this.wss.handleUpgrade(req, socket, head, (ws) => {
                        this.wss.emit('connection', ws, req);
                    });
                }
            });
            this.httpServer.listen(this.config.port, this.config.host || '0.0.0.0', () => {
                const addr = this.httpServer.address();
                this._port = addr.port;
                resolve();
            });
        });
    }
    async stop() {
        this.router.stop(); // stop presence tracker interval
        // Close dashboard clients and upgrader
        if (this.dashboardWs) {
            for (const client of this.dashboardWs.getClients()) {
                client.close(1001, 'Server shutting down');
            }
        }
        if (this.dashboardUpgrader) {
            this.dashboardUpgrader.close();
        }
        this.connectionsByIp.clear();
        // Close agent clients
        for (const client of this.wss.clients) {
            client.close(1001, 'Server shutting down');
        }
        return new Promise((resolve) => {
            this.wss.close(() => {
                this.httpServer.close(() => resolve());
            });
        });
    }
    handleConnection(ws, req) {
        // S2: Connection rate limiting — reject if too many from same IP or at capacity
        const ip = req.socket.remoteAddress ?? 'unknown';
        if (this.wss.clients.size > this.maxTotalConnections) {
            ws.close(1013, 'Server at capacity');
            return;
        }
        const ipCount = (this.connectionsByIp.get(ip) ?? 0) + 1;
        if (ipCount > this.maxConnectionsPerIp) {
            ws.close(1013, 'Too many connections from your IP');
            return;
        }
        this.connectionsByIp.set(ip, ipCount);
        let authenticated = false;
        let connection = null;
        let authAttempts = 0;
        let cleaned = false; // Idempotent cleanup flag — prevents double-decrement
        const maxAuthAttempts = 3;
        const expectedKey = this.config.apiKey;
        const authTimer = setTimeout(() => {
            if (!authenticated) {
                ws.close(1008, 'Authentication timeout');
            }
        }, this.authTimeoutMs);
        // Idempotent cleanup — safe to call from both close and error
        const cleanup = () => {
            if (cleaned)
                return;
            cleaned = true;
            decrementIp();
            clearTimeout(authTimer);
            if (connection) {
                this.router.onAgentDisconnect(connection.sessionId);
                this.connectionManager.unregister(connection.sessionId);
                this.updateDashboardConnectionCount();
            }
        };
        ws.on('message', (data) => {
            try {
                if (!authenticated) {
                    authAttempts++;
                    if (authAttempts > maxAuthAttempts) {
                        clearTimeout(authTimer);
                        ws.close(1008, 'Too many auth attempts');
                        return;
                    }
                    const authMsg = JSON.parse(data.toString());
                    if (authMsg.type === 'auth' && authMsg.agentId) {
                        if (!authMsg.apiKey) {
                            clearTimeout(authTimer);
                            ws.close(1008, 'API key required');
                            return;
                        }
                        // Validate API key — timing-safe comparison to prevent enumeration
                        if (expectedKey) {
                            const a = Buffer.from(String(authMsg.apiKey));
                            const b = Buffer.from(expectedKey);
                            if (a.length !== b.length || !(0, crypto_1.timingSafeEqual)(a, b)) {
                                clearTimeout(authTimer);
                                ws.close(1008, 'Invalid API key');
                                return;
                            }
                        }
                        // Validate agentId format — alphanumeric, hyphens, underscores, max 64 chars
                        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(authMsg.agentId)) {
                            clearTimeout(authTimer);
                            ws.close(1008, 'Invalid agent ID format');
                            return;
                        }
                        clearTimeout(authTimer);
                        const sessionId = (0, crypto_1.randomUUID)();
                        // Handle reconnect collision gracefully
                        try {
                            connection = new agent_connection_1.AgentConnection(sessionId, authMsg.agentId, ws);
                            this.connectionManager.register(sessionId, connection);
                        }
                        catch (regErr) {
                            ws.close(1008, 'Agent ID already connected');
                            return;
                        }
                        authenticated = true;
                        this.updateDashboardConnectionCount();
                        ws.send(JSON.stringify({ type: 'auth_ok', sessionId, agentId: authMsg.agentId }));
                        return;
                    }
                    clearTimeout(authTimer);
                    ws.close(1008, 'Authentication required');
                    return;
                }
                // Authenticated — normalize RawData, decode MessagePack, and route
                const buf = Array.isArray(data) ? Buffer.concat(data) : (data instanceof Buffer ? data : Buffer.from(data));
                const envelope = this.codec.decode(buf);
                envelope.sid = connection.agentId;
                this.router.route(envelope, connection);
            }
            catch (err) {
                if (authenticated) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
                }
                else {
                    clearTimeout(authTimer);
                    ws.close(1008, 'Bad request');
                }
            }
        });
        const decrementIp = () => {
            const current = this.connectionsByIp.get(ip) ?? 1;
            if (current <= 1) {
                this.connectionsByIp.delete(ip);
            }
            else {
                this.connectionsByIp.set(ip, current - 1);
            }
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);
    }
    handleHttp(req, res) {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', connections: this.connectionManager.count }));
            return;
        }
        if (req.url?.startsWith('/dashboard') && this.dashboardRouter) {
            this.dashboardRouter.handle(req, res);
            return;
        }
        res.writeHead(404);
        res.end();
    }
    get dashboardKey() {
        return this.dashboardAuth?.getKey() ?? '';
    }
    get dashboardKeyPrefix() {
        return this.dashboardAuth?.getKeyPrefix() ?? '';
    }
    get dashboardUrl() {
        if (!this.dashboardAuth)
            return '';
        return `http://localhost:${this._port}/dashboard`;
    }
    /** Call from handleConnection cleanup to keep relay count current */
    updateDashboardConnectionCount() {
        this.dashboardRouter?.updateContext({
            relayConnections: this.connectionManager.count,
            connectedAgentIds: this.connectionManager.getAll().map(c => c.agentId),
        });
    }
}
exports.RelayServer = RelayServer;
//# sourceMappingURL=server.js.map