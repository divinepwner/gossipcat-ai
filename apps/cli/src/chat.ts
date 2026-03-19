import { createInterface, Interface } from 'readline';
import { MainAgent, MainAgentConfig } from '@gossip/orchestrator';
import { RelayServer } from '@gossip/relay';
import { ToolServer } from '@gossip/tools';
import { GossipConfig, configToAgentConfigs } from './config';
import { Keychain } from './keychain';

export async function startChat(config: GossipConfig): Promise<void> {
  const keychain = new Keychain();

  // Boot relay (local, random port)
  console.log('Starting local relay...');
  const relay = new RelayServer({ port: 0 });
  await relay.start();
  console.log(`Relay running on port ${relay.port}`);

  // Boot tool server
  console.log('Starting tool server...');
  const toolServer = new ToolServer({
    relayUrl: relay.url,
    projectRoot: process.cwd(),
  });
  await toolServer.start();

  // Get API key for main agent provider
  const mainKey = await keychain.getKey(config.main_agent.provider);

  // Boot main agent
  const mainAgentConfig: MainAgentConfig = {
    provider: config.main_agent.provider,
    model: config.main_agent.model,
    apiKey: mainKey || undefined,
    relayUrl: relay.url,
    agents: configToAgentConfigs(config),
  };

  const mainAgent = new MainAgent(mainAgentConfig);
  await mainAgent.start();

  console.log('\nGossip Mesh ready. Type a task or question. Ctrl+C to exit.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === 'exit' || input === 'quit') {
      await shutdown(relay, toolServer, mainAgent, rl);
      return;
    }

    try {
      console.log('');
      const response = await mainAgent.handleMessage(input);
      console.log(response);
      console.log('');
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
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
  console.log('\nShutting down...');
  rl.close();
  await mainAgent.stop();
  await toolServer.stop();
  await relay.stop();
  process.exit(0);
}
