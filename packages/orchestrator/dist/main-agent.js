"use strict";
/**
 * MainAgent — the developer's single point of contact.
 *
 * Receives natural language tasks, decomposes them via TaskDispatcher,
 * fans out to WorkerAgents, and synthesizes results.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainAgent = void 0;
const llm_client_1 = require("./llm-client");
const agent_registry_1 = require("./agent-registry");
const task_dispatcher_1 = require("./task-dispatcher");
const worker_agent_1 = require("./worker-agent");
const tools_1 = require("@gossip/tools");
const types_1 = require("@gossip/types");
const client_1 = require("@gossip/client");
const msgpack_1 = require("@msgpack/msgpack");
const dispatch_pipeline_1 = require("./dispatch-pipeline");
const CHAT_SYSTEM_PROMPT = `You are a developer assistant powering Gossip Mesh. Be concise and direct.

When you want to present the developer with choices, use this format in your response:

[CHOICES]
message: Your question here?
- option_value | Display Label | Optional hint text
- option_value | Display Label | Optional hint
[/CHOICES]

Examples of when to use choices:
- Multiple approaches to a task (refactor in-place vs extract vs rewrite)
- Confirming a destructive action (delete files, reset branch)
- Selecting which files/modules to work on
- Choosing between trade-offs (speed vs thoroughness)

Only present choices when there's a genuine decision. Don't use them for simple yes/no — just ask directly.
When there's a clear best option, recommend it but still offer alternatives.`;
class MainAgent {
    llm;
    registry;
    dispatcher;
    workers = new Map();
    relayUrl;
    apiKeys;
    projectRoot;
    pipeline;
    bootstrapPrompt;
    orchestratorAgent = null;
    constructor(config) {
        this.llm = config.llm ?? (0, llm_client_1.createProvider)(config.provider, config.model, config.apiKey);
        this.registry = new agent_registry_1.AgentRegistry();
        this.dispatcher = new task_dispatcher_1.TaskDispatcher(this.llm, this.registry);
        this.relayUrl = config.relayUrl;
        this.apiKeys = config.apiKeys ?? {};
        this.bootstrapPrompt = config.bootstrapPrompt || '';
        for (const agent of config.agents) {
            this.registry.register(agent);
        }
        this.projectRoot = config.projectRoot || process.cwd();
        this.pipeline = new dispatch_pipeline_1.DispatchPipeline({
            projectRoot: this.projectRoot,
            workers: this.workers,
            registryGet: (id) => this.registry.get(id),
            llm: this.llm,
            syncFactory: config.syncFactory,
            toolServer: config.toolServer,
        });
    }
    /** Start all worker agents (connect to relay) */
    async start() {
        const { existsSync, readFileSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { join } = await Promise.resolve().then(() => __importStar(require('path')));
        for (const config of this.registry.getAll()) {
            if (this.workers.has(config.id))
                continue; // skip if already set externally
            const llm = (0, llm_client_1.createProvider)(config.provider, config.model, this.apiKeys[config.provider]);
            // Load per-agent instructions if available
            const instructionsPath = join(this.projectRoot, '.gossip', 'agents', config.id, 'instructions.md');
            const instructions = existsSync(instructionsPath)
                ? readFileSync(instructionsPath, 'utf-8') : undefined;
            const worker = new worker_agent_1.WorkerAgent(config.id, llm, this.relayUrl, tools_1.ALL_TOOLS, instructions);
            await worker.start();
            this.workers.set(config.id, worker);
        }
        // Connect orchestrator agent to relay for verify_write review requests
        try {
            this.orchestratorAgent = new client_1.GossipAgent({ agentId: 'orchestrator', relayUrl: this.relayUrl, reconnect: true });
            await this.orchestratorAgent.connect();
            this.orchestratorAgent.on('message', this.handleReviewRequest.bind(this));
        }
        catch (err) {
            console.error(`[MainAgent] Orchestrator relay connection failed: ${err.message}`);
        }
    }
    /** Set externally-created workers (used by MCP server to avoid duplicate connections) */
    setWorkers(externalWorkers) {
        for (const [id, worker] of externalWorkers) {
            this.workers.set(id, worker);
        }
    }
    dispatch(agentId, task, options) { return this.pipeline.dispatch(agentId, task, options); }
    async collect(taskIds, timeoutMs, options) { return this.pipeline.collect(taskIds, timeoutMs, options); }
    async dispatchParallel(tasks, options) { return this.pipeline.dispatchParallel(tasks, options); }
    registerPlan(plan) { this.pipeline.registerPlan(plan); }
    getWorker(agentId) { return this.workers.get(agentId); }
    getTask(taskId) { return this.pipeline.getTask(taskId); }
    setGossipPublisher(publisher) { this.pipeline.setGossipPublisher(publisher); }
    setOverlapDetector(detector) { this.pipeline.setOverlapDetector(detector); }
    setLensGenerator(generator) { this.pipeline.setLensGenerator(generator); }
    /** Register new agent configs (for hot-reload from config changes) */
    registerAgent(config) {
        this.registry.register(config);
    }
    async syncWorkers(keyProvider) {
        const { existsSync, readFileSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { join } = await Promise.resolve().then(() => __importStar(require('path')));
        let added = 0;
        for (const ac of this.registry.getAll()) {
            if (this.workers.has(ac.id))
                continue;
            const key = await keyProvider(ac.provider);
            const llm = (0, llm_client_1.createProvider)(ac.provider, ac.model, key ?? undefined);
            const instructionsPath = join(this.projectRoot, '.gossip', 'agents', ac.id, 'instructions.md');
            const instructions = existsSync(instructionsPath)
                ? readFileSync(instructionsPath, 'utf-8') : undefined;
            const worker = new worker_agent_1.WorkerAgent(ac.id, llm, this.relayUrl, tools_1.ALL_TOOLS, instructions);
            await worker.start();
            this.workers.set(ac.id, worker);
            added++;
        }
        return added;
    }
    /** Stop all worker agents */
    async stop() {
        this.pipeline.flushTaskGraph();
        for (const worker of this.workers.values()) {
            await worker.stop();
        }
        this.workers.clear();
    }
    /** Handle a user message: decompose, dispatch, synthesize. Returns structured ChatResponse. */
    async handleMessage(userMessage) {
        // Extract text for task decomposition (dispatcher needs text only)
        const textForDispatch = typeof userMessage === 'string'
            ? userMessage
            : userMessage.filter(b => b.type === 'text').map(b => b.text).join(' ') || 'Describe this image.';
        const plan = await this.dispatcher.decompose(textForDispatch);
        this.dispatcher.assignAgents(plan);
        // Handle unassigned tasks directly with main LLM
        const unassigned = plan.subTasks.filter(st => !st.assignedAgent);
        if (unassigned.length === plan.subTasks.length) {
            const systemPrompt = this.bootstrapPrompt
                ? this.bootstrapPrompt + '\n\n' + CHAT_SYSTEM_PROMPT
                : CHAT_SYSTEM_PROMPT;
            const response = await this.llm.generate([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ]);
            return this.parseResponse(response.text);
        }
        // Execute assigned sub-tasks
        const results = [];
        const assigned = plan.subTasks.filter(st => st.assignedAgent);
        if (plan.strategy === 'parallel') {
            const promises = assigned.map(subTask => this.executeSubTask(subTask));
            results.push(...await Promise.all(promises));
        }
        else {
            for (const subTask of assigned) {
                results.push(await this.executeSubTask(subTask));
            }
        }
        const text = await this.synthesize(textForDispatch, results);
        return {
            text,
            status: 'done',
            agents: results.map(r => r.agentId),
        };
    }
    /** Handle a user's choice selection — continues the conversation with context */
    async handleChoice(originalMessage, choiceValue) {
        const systemPrompt = this.bootstrapPrompt
            ? this.bootstrapPrompt + '\n\n' + CHAT_SYSTEM_PROMPT
            : CHAT_SYSTEM_PROMPT;
        const response = await this.llm.generate([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: originalMessage },
            { role: 'assistant', content: `I presented options and the developer chose: "${choiceValue}". Proceeding with that approach.` },
            { role: 'user', content: `Yes, go with "${choiceValue}".` },
        ]);
        return this.parseResponse(response.text);
    }
    /**
     * Parse LLM response for structured elements.
     * Detects choice blocks in the format:
     *   [CHOICES]
     *   message: How should I proceed?
     *   - option_value | Display Label | Optional hint
     *   - option_value | Display Label
     *   [/CHOICES]
     */
    parseResponse(text) {
        const choiceMatch = text.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
        if (!choiceMatch) {
            return { text, status: 'done' };
        }
        const choiceBlock = choiceMatch[1].trim();
        const lines = choiceBlock.split('\n').map(l => l.trim()).filter(Boolean);
        const messageLine = lines.find(l => l.startsWith('message:'));
        const optionLines = lines.filter(l => l.startsWith('- '));
        const message = messageLine?.replace('message:', '').trim() || 'How should I proceed?';
        const options = optionLines.map(line => {
            const parts = line.slice(2).split('|').map(p => p.trim());
            return {
                value: parts[0],
                label: parts[1] || parts[0],
                hint: parts[2],
            };
        });
        const textBefore = text.slice(0, text.indexOf('[CHOICES]')).trim();
        const textAfter = text.slice(text.indexOf('[/CHOICES]') + '[/CHOICES]'.length).trim();
        const cleanText = [textBefore, textAfter].filter(Boolean).join('\n\n');
        return {
            text: cleanText,
            choices: options.length > 0 ? { message, options, allowCustom: true, type: 'select' } : undefined,
            status: 'done',
        };
    }
    async handleReviewRequest(data, envelope) {
        if (envelope.t !== types_1.MessageType.RPC_REQUEST)
            return;
        const payload = data;
        if (payload?.tool !== 'review_request')
            return;
        const rawArgs = payload.args;
        if (!rawArgs || typeof rawArgs.callerId !== 'string' || typeof rawArgs.diff !== 'string' || typeof rawArgs.testResult !== 'string') {
            console.error('[MainAgent] Malformed review_request payload — missing or invalid args');
            return;
        }
        const args = rawArgs;
        let reviewText = 'No reviewer available — tests-only verification.';
        try {
            // Find best reviewer, excluding the calling agent
            const reviewer = this.registry.getAll()
                .filter(a => a.id !== args.callerId && a.skills.includes('code_review'))
                .find(a => this.workers.has(a.id));
            if (reviewer) {
                const { promise } = this.pipeline.dispatch(reviewer.id, `Review this diff for correctness:\n\n${args.diff}\n\nTest results:\n${args.testResult}\n\nProvide a brief review: what's good, what needs fixing.`);
                try {
                    reviewText = await promise;
                }
                catch {
                    reviewText = 'Reviewer agent failed.';
                }
            }
        }
        catch (err) {
            reviewText = `Review error: ${err.message}`;
        }
        // Send RPC response back to ToolServer
        try {
            const body = Buffer.from((0, msgpack_1.encode)({ result: reviewText }));
            const correlationId = (envelope.rid_req || envelope.id);
            const response = types_1.Message.createRpcResponse('orchestrator', envelope.sid, correlationId, body);
            await this.orchestratorAgent.sendEnvelope(response.toEnvelope());
        }
        catch (err) {
            console.error(`[MainAgent] Failed to send review response: ${err.message}`);
        }
    }
    async executeSubTask(subTask) {
        const { taskId, promise } = this.pipeline.dispatch(subTask.assignedAgent, subTask.description);
        const start = Date.now();
        try {
            const result = await promise;
            await this.pipeline.writeMemoryForTask(taskId);
            return { agentId: subTask.assignedAgent, task: subTask.description, result, duration: Date.now() - start };
        }
        catch (err) {
            return {
                agentId: subTask.assignedAgent, task: subTask.description,
                result: '', error: err.message, duration: Date.now() - start,
            };
        }
    }
    async synthesize(originalTask, results) {
        if (results.length === 1) {
            return results[0].error || results[0].result;
        }
        const summaryPrompt = results.map(r => `Agent ${r.agentId} (${r.duration}ms):\n${r.error ? `ERROR: ${r.error}` : r.result}`).join('\n\n---\n\n');
        const response = await this.llm.generate([
            { role: 'system', content: 'Synthesize the following agent results into a single coherent response. Be concise.' },
            { role: 'user', content: `Original task: ${originalTask}\n\nAgent results:\n${summaryPrompt}` },
        ]);
        return response.text;
    }
}
exports.MainAgent = MainAgent;
//# sourceMappingURL=main-agent.js.map