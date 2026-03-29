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
            this.wss = new ws_1.WebSocketServer({
                server: this.httpServer,
                maxPayload: 1 * 1024 * 1024, // S1: 1 MiB — rejects oversized frames before buffering
            });
            this.wss.on('connection', this.handleConnection.bind(this));
            this.httpServer.listen(this.config.port, this.config.host || '0.0.0.0', () => {
                const addr = this.httpServer.address();
                this._port = addr.port;
                resolve();
            });
        });
    }
    async stop() {
        this.router.stop(); // stop presence tracker interval
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
        res.writeHead(404);
        res.end();
    }
}
exports.RelayServer = RelayServer;
//# sourceMappingURL=server.js.map