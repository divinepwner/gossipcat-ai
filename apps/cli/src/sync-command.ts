import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { TaskGraph, TaskGraphSync } from '@gossip/orchestrator';
import { Keychain } from './keychain';
import { getUserId, getProjectId } from './identity';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};

interface SupabaseConfig {
  url: string;
  projectRef: string;
}

function loadSupabaseConfig(): SupabaseConfig | null {
  const configPath = join(process.cwd(), '.gossip', 'supabase.json');
  if (!existsSync(configPath)) return null;
  try { return JSON.parse(readFileSync(configPath, 'utf-8')); }
  catch { return null; }
}

function saveSupabaseConfig(config: SupabaseConfig): void {
  const gossipDir = join(process.cwd(), '.gossip');
  mkdirSync(gossipDir, { recursive: true });
  writeFileSync(join(gossipDir, 'supabase.json'), JSON.stringify(config, null, 2));
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const flag = args[0];

  if (flag === '--setup') { await runSetup(); return; }
  if (flag === '--status') { showStatus(); return; }

  const config = loadSupabaseConfig();
  if (!config) {
    console.log(`${c.yellow}Supabase not configured.${c.reset} Run: gossipcat sync --setup`);
    return;
  }

  const keychain = new Keychain();
  const key = await keychain.getKey('supabase');
  if (!key) {
    console.log(`${c.red}No Supabase API key found in keychain.${c.reset} Run: gossipcat sync --setup`);
    return;
  }

  const cwd = process.cwd();
  const graph = new TaskGraph(cwd);
  const sync = new TaskGraphSync(graph, config.url, key, getUserId(cwd), getProjectId(cwd), cwd);

  console.log('Syncing to Supabase...');
  const result = await sync.sync();

  if (result.errors.length) {
    console.log(`${c.yellow}Synced ${result.events} events with ${result.errors.length} errors:${c.reset}`);
    for (const err of result.errors) console.log(`  ${c.red}${err}${c.reset}`);
  } else {
    console.log(`${c.green}Synced ${result.events} events, ${result.scores} scores.${c.reset}`);
  }
}

function showStatus(): void {
  const config = loadSupabaseConfig();
  const graph = new TaskGraph(process.cwd());
  const meta = graph.getSyncMeta();

  console.log(`\n${c.bold}Sync Status${c.reset}\n`);
  console.log(`  Supabase: ${config ? `${c.green}configured${c.reset} (${config.url})` : `${c.dim}not configured${c.reset}`}`);
  console.log(`  Total events: ${graph.getEventCount()}`);
  console.log(`  Last sync: ${meta.lastSync || 'never'}`);
  console.log(`  Synced events: ${meta.lastSyncEventCount}`);
  console.log(`  Pending: ${graph.getEventCount() - meta.lastSyncEventCount}`);
  console.log('');
}

async function runSetup(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log(`\n${c.bold}Supabase Sync Setup${c.reset}\n`);

  const existing = loadSupabaseConfig();
  if (existing) {
    console.log(`  Existing config: ${existing.url}`);
    const overwrite = await ask('  Overwrite? (y/N) ');
    if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
  }

  const url = await ask(`  Supabase URL (e.g. https://xxx.supabase.co): `);
  if (!url.startsWith('https://')) {
    console.log(`${c.red}URL must start with https://${c.reset}`);
    rl.close(); return;
  }

  const ref = url.replace('https://', '').replace('.supabase.co', '');
  const key = await ask(`  Supabase anon key: `);
  if (!key) { console.log(`${c.red}Key required.${c.reset}`); rl.close(); return; }

  rl.close();

  saveSupabaseConfig({ url, projectRef: ref });
  const keychain = new Keychain();
  await keychain.setKey('supabase', key);

  console.log(`\n${c.green}Supabase configured.${c.reset}`);
  console.log(`  Config: .gossip/supabase.json`);
  console.log(`  Key: stored in keychain`);
  console.log(`\n  Run the migration SQL in your Supabase dashboard:`);
  console.log(`  ${c.dim}See docs/migrations/001-taskgraph-schema.sql${c.reset}`);
  console.log(`\n  Then run: ${c.cyan}gossipcat sync${c.reset} to sync existing events.\n`);
}
