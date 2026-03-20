#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Gossipcat MCP Server — exposes orchestration tools to Claude Code.
 *
 * Claude Code connects to this as an MCP server. The developer can then
 * say "use gossip_orchestrate to review my code with local agents" and
 * Claude Code calls these tools natively.
 */
const relay_1 = require("@gossip/relay");
const tools_1 = require("@gossip/tools");
const orchestrator_1 = require("@gossip/orchestrator");
const config_1 = require("./config");
const keychain_1 = require("./keychain");
// ── Tool Definitions ────────────────────────────────────────────────────────
const MCP_TOOLS = [
    {
        name: 'gossip_orchestrate',
        description: 'Submit a task to the Gossip Mesh agent team for multi-agent execution. The orchestrator decomposes the task, assigns sub-tasks to available agents (local Qwen, Claude, GPT, Gemini), and returns the synthesized result. Use this for code review, implementation, debugging, or any task that benefits from multiple perspectives.',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'The task to execute. Be specific about what you want and which files are relevant.',
                },
                strategy: {
                    type: 'string',
                    enum: ['auto', 'parallel', 'sequential'],
                    description: 'Execution strategy. "auto" lets the orchestrator decide. Default: auto.',
                },
            },
            required: ['task'],
        },
    },
    {
        name: 'gossip_agents',
        description: 'List all configured agents in the Gossip Mesh team, including their provider, model, role, and skills. Use this to understand what agents are available before orchestrating.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'gossip_status',
        description: 'Check the status of the Gossip Mesh system — relay, tool server, and connected agents.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
];
// ── MCP Server ──────────────────────────────────────────────────────────────
class GossipMcpServer {
    relay = null;
    toolServer = null;
    mainAgent = null;
    initialized = false;
    async handleRequest(request) {
        try {
            switch (request.method) {
                case 'initialize':
                    return this.respond(request.id, {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'gossipcat', version: '0.1.0' },
                    });
                case 'notifications/initialized':
                    // Notifications must not receive a response per JSON-RPC spec.
                    return null;
                case 'tools/list':
                    return this.respond(request.id, { tools: MCP_TOOLS });
                case 'tools/call':
                    return await this.handleToolCall(request);
                default:
                    return this.respondError(request.id, -32601, `Method not found: ${request.method}`);
            }
        }
        catch (err) {
            return this.respondError(request.id, -32603, err.message);
        }
    }
    async handleToolCall(request) {
        const params = request.params;
        const name = params?.name;
        const args = params?.arguments;
        // Lazy initialization — boot relay + agents on first gossip_orchestrate call
        if (!this.initialized && name === 'gossip_orchestrate') {
            await this.boot();
        }
        switch (name) {
            case 'gossip_orchestrate': {
                if (!this.mainAgent) {
                    return this.respond(request.id, {
                        content: [
                            {
                                type: 'text',
                                text: 'Error: Gossip Mesh not initialized. Check gossip.agents.json config.',
                            },
                        ],
                    });
                }
                const task = args?.task || '';
                try {
                    const response = await this.mainAgent.handleMessage(task);
                    const agentSuffix = response.agents && response.agents.length > 0
                        ? `\n\n[Agents used: ${response.agents.join(', ')}]`
                        : '';
                    const text = response.text + agentSuffix;
                    return this.respond(request.id, {
                        content: [{ type: 'text', text }],
                    });
                }
                catch (err) {
                    return this.respond(request.id, {
                        content: [
                            {
                                type: 'text',
                                text: `Orchestration error: ${err.message}`,
                            },
                        ],
                    });
                }
            }
            case 'gossip_agents': {
                const configPath = (0, config_1.findConfigPath)();
                if (!configPath) {
                    return this.respond(request.id, {
                        content: [
                            {
                                type: 'text',
                                text: 'No gossip.agents.json found. Run gossipcat setup first.',
                            },
                        ],
                    });
                }
                const config = (0, config_1.loadConfig)(configPath);
                const agents = (0, config_1.configToAgentConfigs)(config);
                const agentList = agents
                    .map((a) => `- ${a.id}: ${a.provider}/${a.model} (${a.preset || 'custom'}) — skills: ${a.skills.join(', ')}`)
                    .join('\n');
                const text = `Orchestrator: ${config.main_agent.model} (${config.main_agent.provider})\n\nAgents:\n${agentList}`;
                return this.respond(request.id, {
                    content: [{ type: 'text', text }],
                });
            }
            case 'gossip_status': {
                const relayStatus = this.relay
                    ? `running on port ${this.relay.port}`
                    : 'not started';
                const toolStatus = this.toolServer ? 'running' : 'not started';
                const agentStatus = this.mainAgent ? 'ready' : 'not initialized';
                const text = [
                    'Gossip Mesh Status:',
                    `- Relay: ${relayStatus}`,
                    `- Tool Server: ${toolStatus}`,
                    `- Orchestrator: ${agentStatus}`,
                    `- Initialized: ${this.initialized}`,
                ].join('\n');
                return this.respond(request.id, {
                    content: [{ type: 'text', text }],
                });
            }
            default:
                return this.respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
        }
    }
    async boot() {
        const configPath = (0, config_1.findConfigPath)();
        if (!configPath) {
            throw new Error('No gossip.agents.json found. Run gossipcat setup first.');
        }
        const config = (0, config_1.loadConfig)(configPath);
        const keychain = new keychain_1.Keychain();
        // Start relay — port 0 lets the OS pick a free port
        this.relay = new relay_1.RelayServer({ port: 0 });
        await this.relay.start();
        // Start tool server
        this.toolServer = new tools_1.ToolServer({
            relayUrl: this.relay.url,
            projectRoot: process.cwd(),
        });
        await this.toolServer.start();
        // Start main agent
        const mainKey = await keychain.getKey(config.main_agent.provider);
        const agentConfigs = (0, config_1.configToAgentConfigs)(config);
        const mainAgentConfig = {
            provider: config.main_agent.provider,
            model: config.main_agent.model,
            apiKey: mainKey ?? undefined,
            relayUrl: this.relay.url,
            agents: agentConfigs,
        };
        this.mainAgent = new orchestrator_1.MainAgent(mainAgentConfig);
        await this.mainAgent.start();
        this.initialized = true;
        // Log to stderr — stdout is reserved for MCP JSON-RPC
        process.stderr.write(`[gossipcat-mcp] Booted: relay :${this.relay.port}, ${agentConfigs.length} agents\n`);
    }
    respond(id, result) {
        return { jsonrpc: '2.0', id, result };
    }
    respondError(id, code, message) {
        return { jsonrpc: '2.0', id, error: { code, message } };
    }
    async shutdown() {
        if (this.mainAgent)
            await this.mainAgent.stop();
        if (this.toolServer)
            await this.toolServer.stop();
        if (this.relay)
            await this.relay.stop();
    }
}
// ── stdio transport ─────────────────────────────────────────────────────────
async function main() {
    const server = new GossipMcpServer();
    let buffer = '';
    process.stdin.on('data', (chunk) => {
        buffer += chunk.toString();
        // MCP uses Content-Length framing (LSP-style)
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                // Fallback: try line-delimited JSON
                const lineEnd = buffer.indexOf('\n');
                if (lineEnd === -1)
                    break;
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                if (line) {
                    handleLine(server, line).catch((err) => {
                        process.stderr.write(`[gossipcat-mcp] Unhandled error: ${err.message}\n`);
                    });
                }
                continue;
            }
            const header = buffer.slice(0, headerEnd);
            const contentLengthMatch = header.match(/Content-Length: (\d+)/);
            if (!contentLengthMatch)
                break;
            const contentLength = parseInt(contentLengthMatch[1], 10);
            const bodyStart = headerEnd + 4; // skip \r\n\r\n
            if (buffer.length < bodyStart + contentLength)
                break; // wait for more data
            const body = buffer.slice(bodyStart, bodyStart + contentLength);
            buffer = buffer.slice(bodyStart + contentLength);
            handleLine(server, body).catch((err) => {
                process.stderr.write(`[gossipcat-mcp] Unhandled error: ${err.message}\n`);
            });
        }
    });
    process.on('SIGINT', async () => {
        await server.shutdown();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await server.shutdown();
        process.exit(0);
    });
    // Keep the process alive while stdin is open
    process.stdin.resume();
}
async function handleLine(server, line) {
    try {
        const request = JSON.parse(line);
        // JSON-RPC notifications have no id — do not send a response
        if (request.id === undefined || request.id === null) {
            await server.handleRequest({ ...request, id: 0 });
            return;
        }
        const response = await server.handleRequest(request);
        if (response === null)
            return; // notification — no response
        const responseStr = JSON.stringify(response);
        const header = `Content-Length: ${Buffer.byteLength(responseStr)}\r\n\r\n`;
        process.stdout.write(header + responseStr);
    }
    catch (err) {
        process.stderr.write(`[gossipcat-mcp] Parse error: ${err.message}\n`);
    }
}
main().catch((err) => {
    process.stderr.write(`[gossipcat-mcp] Fatal: ${err.message}\n`);
    process.exit(1);
});
//# sourceMappingURL=mcp-server.js.map