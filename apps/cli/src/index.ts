#!/usr/bin/env node
import { findConfigPath, loadConfig } from './config';
import { runSetupWizard } from './setup-wizard';
import { startChat } from './chat';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // gossip setup — re-run wizard
  if (args[0] === 'setup') {
    await runSetupWizard();
    return;
  }

  // Check for config
  const configPath = findConfigPath();
  if (!configPath) {
    console.log('No gossip.agents.json found. Running setup wizard...');
    await runSetupWizard();
    return;
  }

  // Load and validate config (fail fast)
  const config = loadConfig(configPath);

  // gossip "one-shot task" — run and exit
  if (args.length > 0) {
    const task = args.join(' ');
    console.log(`One-shot mode not yet implemented. Task: "${task}"`);
    console.log("Run 'gossipcat' for interactive chat.");
    return;
  }

  // gossip — interactive chat
  await startChat(config);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
