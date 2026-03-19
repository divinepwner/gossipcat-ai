import * as p from '@clack/prompts';
import { createInterface, Interface } from 'readline';
import { MainAgent, MainAgentConfig, ChatResponse } from '@gossip/orchestrator';
import { RelayServer } from '@gossip/relay';
import { ToolServer } from '@gossip/tools';
import { GossipConfig, configToAgentConfigs } from './config';
import { Keychain } from './keychain';

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

// ── Render a ChatResponse ───────────────────────────────────────────────────
async function renderResponse(
  response: ChatResponse,
  originalMessage: string,
  mainAgent: MainAgent,
): Promise<void> {
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
      if (p.isCancel(confirmed)) return;
      const choice = confirmed ? 'yes' : 'no';
      const followUp = await mainAgent.handleChoice(originalMessage, choice);
      await renderResponse(followUp, originalMessage, mainAgent);

    } else if (response.choices.type === 'multiselect') {
      const selected = await p.multiselect({
        message: response.choices.message,
        options,
        required: true,
      });
      if (p.isCancel(selected)) return;
      const choice = (selected as string[]).join(', ');
      const followUp = await mainAgent.handleChoice(originalMessage, choice);
      await renderResponse(followUp, originalMessage, mainAgent);

    } else {
      // Default: single select
      const selected = await p.select({
        message: response.choices.message,
        options,
      });
      if (p.isCancel(selected)) return;

      if (selected === '__custom__') {
        const custom = await p.text({
          message: 'What do you want instead?',
          placeholder: 'Describe your preferred approach...',
        });
        if (p.isCancel(custom)) return;
        const followUp = await mainAgent.handleChoice(originalMessage, custom as string);
        await renderResponse(followUp, originalMessage, mainAgent);
      } else {
        const followUp = await mainAgent.handleChoice(originalMessage, selected as string);
        await renderResponse(followUp, originalMessage, mainAgent);
      }
    }
  }

  console.log('');
}

// ── Main chat loop ──────────────────────────────────────────────────────────
export async function startChat(config: GossipConfig): Promise<void> {
  const keychain = new Keychain();

  // ── Boot infrastructure ─────────────────────────────────────────────────
  const s = p.spinner();
  s.start('Starting Gossip Mesh...');

  const relay = new RelayServer({ port: 0 });
  await relay.start();

  const toolServer = new ToolServer({
    relayUrl: relay.url,
    projectRoot: process.cwd(),
  });
  await toolServer.start();

  const mainKey = await keychain.getKey(config.main_agent.provider);

  const mainAgentConfig: MainAgentConfig = {
    provider: config.main_agent.provider,
    model: config.main_agent.model,
    apiKey: mainKey || undefined,
    relayUrl: relay.url,
    agents: configToAgentConfigs(config),
  };

  const mainAgent = new MainAgent(mainAgentConfig);
  await mainAgent.start();

  const agentCount = configToAgentConfigs(config).length;
  s.stop(`Ready — ${agentCount} agent${agentCount !== 1 ? 's' : ''} online (relay :${relay.port})`);

  console.log(`${c.dim}  Type a task or question. "exit" to quit.${c.reset}\n`);

  // ── REPL loop ───────────────────────────────────────────────────────────
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.cyan}>${c.reset} `,
  });
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
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
    } catch (err) {
      process.stdout.write('\r\x1b[K');
      console.log(`\n${c.yellow}  Error: ${(err as Error).message}${c.reset}\n`);
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

async function shutdown(
  relay: RelayServer,
  toolServer: ToolServer,
  mainAgent: MainAgent,
  rl: Interface,
): Promise<void> {
  console.log(`\n${c.dim}  Shutting down...${c.reset}`);
  rl.close();
  await mainAgent.stop();
  await toolServer.stop();
  await relay.stop();
  process.exit(0);
}
