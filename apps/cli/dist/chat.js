"use strict";
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
exports.startChat = startChat;
const p = __importStar(require("@clack/prompts"));
const readline_1 = require("readline");
const orchestrator_1 = require("@gossip/orchestrator");
const relay_1 = require("@gossip/relay");
const tools_1 = require("@gossip/tools");
const config_1 = require("./config");
const keychain_1 = require("./keychain");
// ── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
};
// ── Render a ChatResponse ───────────────────────────────────────────────────
async function renderResponse(response, originalMessage, mainAgent) {
    // Show agent attribution if multiple agents contributed
    if (response.agents && response.agents.length > 1) {
        console.log(`${c.dim}  Agents: ${response.agents.join(', ')}${c.reset}`);
    }
    // Show main text
    if (response.text) {
        console.log('');
        console.log(response.text);
    }
    // Show interactive choices if present
    if (response.choices && response.choices.options.length > 0) {
        console.log('');
        const options = response.choices.options.map(opt => ({
            value: opt.value,
            label: opt.label,
            hint: opt.hint,
        }));
        // Add custom input option if allowed
        if (response.choices.allowCustom) {
            options.push({
                value: '__custom__',
                label: 'Let me explain what I want...',
                hint: 'Type a custom response',
            });
        }
        if (response.choices.type === 'confirm') {
            const confirmed = await p.confirm({
                message: response.choices.message,
            });
            if (p.isCancel(confirmed))
                return;
            const choice = confirmed ? 'yes' : 'no';
            const followUp = await mainAgent.handleChoice(originalMessage, choice);
            await renderResponse(followUp, originalMessage, mainAgent);
        }
        else if (response.choices.type === 'multiselect') {
            const selected = await p.multiselect({
                message: response.choices.message,
                options,
                required: true,
            });
            if (p.isCancel(selected))
                return;
            const choice = selected.join(', ');
            const followUp = await mainAgent.handleChoice(originalMessage, choice);
            await renderResponse(followUp, originalMessage, mainAgent);
        }
        else {
            // Default: single select
            const selected = await p.select({
                message: response.choices.message,
                options,
            });
            if (p.isCancel(selected))
                return;
            if (selected === '__custom__') {
                const custom = await p.text({
                    message: 'What do you want instead?',
                    placeholder: 'Describe your preferred approach...',
                });
                if (p.isCancel(custom))
                    return;
                const followUp = await mainAgent.handleChoice(originalMessage, custom);
                await renderResponse(followUp, originalMessage, mainAgent);
            }
            else {
                const followUp = await mainAgent.handleChoice(originalMessage, selected);
                await renderResponse(followUp, originalMessage, mainAgent);
            }
        }
    }
    console.log('');
}
// ── Main chat loop ──────────────────────────────────────────────────────────
async function startChat(config) {
    const keychain = new keychain_1.Keychain();
    // ── Boot infrastructure ─────────────────────────────────────────────────
    const s = p.spinner();
    s.start('Starting Gossip Mesh...');
    const relay = new relay_1.RelayServer({ port: 0 });
    await relay.start();
    const toolServer = new tools_1.ToolServer({
        relayUrl: relay.url,
        projectRoot: process.cwd(),
    });
    await toolServer.start();
    const mainKey = await keychain.getKey(config.main_agent.provider);
    const mainAgentConfig = {
        provider: config.main_agent.provider,
        model: config.main_agent.model,
        apiKey: mainKey || undefined,
        relayUrl: relay.url,
        agents: (0, config_1.configToAgentConfigs)(config),
    };
    const mainAgent = new orchestrator_1.MainAgent(mainAgentConfig);
    await mainAgent.start();
    const agentCount = (0, config_1.configToAgentConfigs)(config).length;
    s.stop(`Ready — ${agentCount} agent${agentCount !== 1 ? 's' : ''} online (relay :${relay.port})`);
    console.log(`${c.dim}  Type a task or question. "exit" to quit.${c.reset}\n`);
    // ── REPL loop ───────────────────────────────────────────────────────────
    const rl = (0, readline_1.createInterface)({
        input: process.stdin,
        output: process.stdout,
        prompt: `${c.cyan}>${c.reset} `,
    });
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        if (input === 'exit' || input === 'quit') {
            await shutdown(relay, toolServer, mainAgent, rl);
            return;
        }
        try {
            // Show spinner while agent thinks
            // We can't use p.spinner here because readline is active
            // Instead show a simple indicator
            process.stdout.write(`${c.dim}  thinking...${c.reset}`);
            const response = await mainAgent.handleMessage(input);
            // Clear the "thinking..." line
            process.stdout.write('\r\x1b[K');
            await renderResponse(response, input, mainAgent);
        }
        catch (err) {
            process.stdout.write('\r\x1b[K');
            console.log(`\n${c.yellow}  Error: ${err.message}${c.reset}\n`);
        }
        rl.prompt();
    });
    rl.on('close', async () => {
        await shutdown(relay, toolServer, mainAgent, rl);
    });
    process.on('SIGINT', async () => {
        await shutdown(relay, toolServer, mainAgent, rl);
    });
}
async function shutdown(relay, toolServer, mainAgent, rl) {
    console.log(`\n${c.dim}  Shutting down...${c.reset}`);
    rl.close();
    await mainAgent.stop();
    await toolServer.stop();
    await relay.stop();
    process.exit(0);
}
//# sourceMappingURL=chat.js.map