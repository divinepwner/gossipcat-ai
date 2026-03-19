import { createInterface } from 'readline';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { Keychain } from './keychain';

export async function runSetupWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(res => rl.question(q, res));

  console.log('\n  Welcome to Gossip Mesh! Let\'s set up your agent team.\n');

  // Step 1: API Keys
  console.log('  Step 1/3: API Keys');
  const keychain = new Keychain();
  const providers: Array<{ name: string; key: string }> = [];

  const anthropicKey = await ask('  Anthropic API key (or press Enter to skip): ');
  if (anthropicKey.trim()) {
    await keychain.setKey('anthropic', anthropicKey.trim());
    providers.push({ name: 'anthropic', key: anthropicKey.trim() });
  }

  const openaiKey = await ask('  OpenAI API key (or press Enter to skip): ');
  if (openaiKey.trim()) {
    await keychain.setKey('openai', openaiKey.trim());
    providers.push({ name: 'openai', key: openaiKey.trim() });
  }

  const googleKey = await ask('  Google AI API key (or press Enter to skip): ');
  if (googleKey.trim()) {
    await keychain.setKey('google', googleKey.trim());
    providers.push({ name: 'google', key: googleKey.trim() });
  }

  // Check for local Ollama
  let hasOllama = false;
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (res.ok) {
      hasOllama = true;
      console.log('  Ollama detected on localhost:11434');
    }
  } catch { /* no Ollama */ }

  if (providers.length === 0 && !hasOllama) {
    console.log('\n  No API keys configured and no local model detected.');
    console.log('  You can add keys later with: gossip setup\n');
    rl.close();
    return;
  }

  // Step 2: Main Agent
  console.log('\n  Step 2/3: Main Agent');
  const mainProvider = providers[0]?.name || 'local';
  const defaultModel =
    mainProvider === 'anthropic' ? 'claude-sonnet-4-6'
    : mainProvider === 'openai' ? 'gpt-4o'
    : mainProvider === 'google' ? 'gemini-2.5-flash'
    : 'qwen2.5:32b';

  const mainModelInput = await ask(`  Main agent model (default: ${defaultModel}): `);

  // Step 3: Build config
  console.log('\n  Step 3/3: Agent Team');
  const config: any = {
    main_agent: {
      provider: mainProvider,
      model: mainModelInput.trim() || defaultModel,
    },
    agents: {},
  };

  if (providers.find(p => p.name === 'anthropic')) {
    config.agents['claude-arch'] = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      preset: 'architect',
      skills: ['typescript', 'system_design', 'code_review', 'api_design'],
    };
  }
  if (providers.find(p => p.name === 'openai')) {
    config.agents['gpt-impl'] = {
      provider: 'openai',
      model: 'gpt-4o',
      preset: 'implementer',
      skills: ['typescript', 'implementation', 'testing', 'react'],
    };
  }
  if (hasOllama) {
    config.agents['local-reviewer'] = {
      provider: 'local',
      model: 'qwen2.5:32b',
      preset: 'reviewer',
      skills: ['code_review', 'debugging', 'fast_iteration'],
    };
  }

  const configPath = resolve(process.cwd(), 'gossip.agents.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  Config saved to ${configPath}`);
  console.log('  Keys stored in system keychain');
  console.log('\n  You\'re ready. Run `gossip` to start chatting.\n');

  rl.close();
}
