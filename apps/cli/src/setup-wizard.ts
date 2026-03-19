import { createInterface } from 'readline';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { Keychain } from './keychain';

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  bgBlue:  '\x1b[44m',
};

const LOGO = `
${c.cyan}${c.bold}   ╔══════════════════════════════════════╗
   ║        ${c.magenta}GOSSIP MESH${c.cyan}  v0.1.0          ║
   ║  ${c.white}Multi-Agent Orchestration Platform${c.cyan}   ║
   ╚══════════════════════════════════════╝${c.reset}
`;

const PROVIDER_INFO: Record<string, { display: string; color: string; models: string[] }> = {
  anthropic: {
    display: 'Anthropic (Claude)',
    color: c.magenta,
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  openai: {
    display: 'OpenAI (GPT)',
    color: c.green,
    models: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini'],
  },
  google: {
    display: 'Google (Gemini)',
    color: c.blue,
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
};

const PRESETS: Record<string, { label: string; skills: string[] }> = {
  architect:   { label: 'Architect — design, decompose, review',     skills: ['typescript', 'system_design', 'code_review', 'api_design'] },
  implementer: { label: 'Implementer — write code, build features',  skills: ['typescript', 'implementation', 'testing', 'react'] },
  reviewer:    { label: 'Reviewer — find bugs, security, quality',   skills: ['code_review', 'security_audit', 'debugging'] },
  tester:      { label: 'Tester — write tests, verify, coverage',    skills: ['testing', 'debugging', 'e2e', 'integration'] },
  researcher:  { label: 'Researcher — read docs, gather context',    skills: ['documentation', 'api_design', 'research'] },
  debugger:    { label: 'Debugger — investigate errors, root cause',  skills: ['debugging', 'testing', 'code_review'] },
};

function step(num: number, total: number, title: string): void {
  console.log(`\n  ${c.bgBlue}${c.white}${c.bold} ${num}/${total} ${c.reset} ${c.bold}${title}${c.reset}\n`);
}

function success(msg: string): void {
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}

function info(msg: string): void {
  console.log(`  ${c.gray}${msg}${c.reset}`);
}

function showMenu(options: string[], labels: string[]): void {
  options.forEach((_, i) => {
    console.log(`  ${c.cyan}${c.bold}${i + 1}${c.reset}  ${labels[i]}`);
  });
}

function agentCard(id: string, provider: string, model: string, preset: string, skills: string[]): void {
  console.log(`  ${c.cyan}┌─${c.reset} ${c.bold}${id}${c.reset}`);
  console.log(`  ${c.cyan}│${c.reset}  ${c.dim}Provider:${c.reset} ${provider}  ${c.dim}Model:${c.reset} ${model}`);
  console.log(`  ${c.cyan}│${c.reset}  ${c.dim}Role:${c.reset}     ${preset}  ${c.dim}Skills:${c.reset} ${skills.join(', ')}`);
  console.log(`  ${c.cyan}└──────${c.reset}`);
}

export async function runSetupWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(res => rl.question(q, res));

  const selectOne = async (prompt: string, options: string[], labels: string[]): Promise<string> => {
    showMenu(options, labels);
    console.log('');
    while (true) {
      const answer = await ask(`  ${prompt} `);
      const num = parseInt(answer.trim());
      if (num >= 1 && num <= options.length) return options[num - 1];
      console.log(`  ${c.yellow}Enter a number 1-${options.length}${c.reset}`);
    }
  };

  const selectMany = async (prompt: string, options: string[], labels: string[]): Promise<string[]> => {
    showMenu(options, labels);
    console.log('');
    while (true) {
      const answer = await ask(`  ${prompt} `);
      const nums = answer.trim().split(/[,\s]+/).map(s => parseInt(s)).filter(n => !isNaN(n));
      if (nums.length > 0 && nums.every(n => n >= 1 && n <= options.length)) {
        return nums.map(n => options[n - 1]);
      }
      console.log(`  ${c.yellow}Enter numbers separated by commas (e.g. 1,2,3)${c.reset}`);
    }
  };

  console.log(LOGO);

  // ── Step 1: Select Providers ──────────────────────────────────────────────
  step(1, 4, 'Select Your Providers');
  info('Which LLM providers do you want to use?\n');

  const providerKeys = Object.keys(PROVIDER_INFO);
  const providerLabels = providerKeys.map(k => {
    const p = PROVIDER_INFO[k];
    return `${p.color}${p.display}${c.reset}`;
  });

  // Check for Ollama
  let ollamaModels: string[] = [];
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (res.ok) {
      const data = await res.json() as any;
      ollamaModels = (data.models || []).map((m: any) => m.name);
    }
  } catch { /* no Ollama */ }

  if (ollamaModels.length > 0) {
    providerKeys.push('local');
    providerLabels.push(`${c.yellow}Local (Ollama)${c.reset} ${c.dim}— ${ollamaModels.length} model${ollamaModels.length > 1 ? 's' : ''} detected${c.reset}`);
  }

  const selectedProviders = await selectMany(
    `Select providers ${c.dim}(e.g. 1,2)${c.reset}:`,
    providerKeys,
    providerLabels
  );

  // ── Step 2: API Keys for Selected Providers ───────────────────────────────
  step(2, 4, 'Enter API Keys');
  const keychain = new Keychain();
  const configuredProviders: Array<{ name: string }> = [];

  for (const provider of selectedProviders) {
    if (provider === 'local') {
      success(`Ollama — no API key needed`);
      configuredProviders.push({ name: 'local' });
      continue;
    }

    const pInfo = PROVIDER_INFO[provider];
    const key = await ask(`  ${pInfo.color}${pInfo.display}${c.reset} API key: `);
    if (key.trim()) {
      await keychain.setKey(provider, key.trim());
      configuredProviders.push({ name: provider });
      success(`${pInfo.display} — key saved`);
    } else {
      info(`${pInfo.display} skipped (no key entered)`);
    }
  }

  if (configuredProviders.length === 0) {
    console.log(`\n  ${c.yellow}${c.bold}No providers configured.${c.reset}`);
    console.log(`  ${c.dim}Run ${c.white}gossipcat setup${c.dim} to try again.${c.reset}\n`);
    rl.close();
    return;
  }

  // ── Step 3: Select Models ─────────────────────────────────────────────────
  step(3, 4, 'Choose Models');

  // Main agent model
  info('Select the model for your main agent (orchestrator).');
  info('Tip: Use a fast model — it routes tasks, not heavy work.\n');

  const mainProvider = configuredProviders[0].name;
  const mainModels = mainProvider === 'local'
    ? ollamaModels.slice(0, 8)
    : PROVIDER_INFO[mainProvider]?.models || [];

  const mainModel = await selectOne(
    `Orchestrator model:`,
    mainModels,
    mainModels.map((m, i) => i === 0 ? `${c.bold}${m}${c.reset} ${c.dim}(recommended)${c.reset}` : m)
  );
  success(`Orchestrator: ${c.bold}${mainModel}${c.reset} ${c.dim}(${mainProvider})${c.reset}`);

  // ── Step 4: Build Agent Team ──────────────────────────────────────────────
  step(4, 4, 'Configure Agent Team');
  info('Each agent gets a role and an LLM. You can customize later.\n');

  const config: any = {
    main_agent: { provider: mainProvider, model: mainModel },
    agents: {} as Record<string, any>,
  };

  const presetKeys = Object.keys(PRESETS);
  const presetLabels = presetKeys.map(k => PRESETS[k].label);

  for (const provider of configuredProviders) {
    const pInfo = provider.name === 'local'
      ? { display: 'Local (Ollama)', color: c.yellow, models: ollamaModels.slice(0, 8) }
      : PROVIDER_INFO[provider.name];

    console.log(`\n  ${pInfo.color}${c.bold}${pInfo.display}${c.reset}`);

    // Select role/preset
    const preset = await selectOne(
      `Role for this agent:`,
      presetKeys,
      presetLabels
    );

    // Select model
    const models = pInfo.models;
    const model = await selectOne(
      `Model:`,
      models,
      models.map((m, i) => i === 0 ? `${c.bold}${m}${c.reset} ${c.dim}(recommended)${c.reset}` : m)
    );

    // Generate agent ID
    const shortProvider = provider.name === 'anthropic' ? 'claude'
      : provider.name === 'openai' ? 'gpt'
      : provider.name === 'google' ? 'gemini'
      : 'local';
    const agentId = `${shortProvider}-${preset}`;

    const agentConfig = {
      provider: provider.name,
      model,
      preset,
      skills: PRESETS[preset].skills,
    };
    config.agents[agentId] = agentConfig;

    console.log('');
    agentCard(agentId, provider.name, model, preset, PRESETS[preset].skills);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const configPath = resolve(process.cwd(), 'gossip.agents.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`\n  ${c.cyan}──────────────────────────────────────${c.reset}`);
  success(`Config saved to ${c.dim}gossip.agents.json${c.reset}`);
  success(`Keys stored in ${c.dim}system keychain${c.reset}`);
  console.log('');

  // Show final team summary
  const agentCount = Object.keys(config.agents).length;
  console.log(`  ${c.bold}Your team (${agentCount} agent${agentCount > 1 ? 's' : ''})${c.reset}`);
  for (const [id, agent] of Object.entries(config.agents as Record<string, any>)) {
    agentCard(id, agent.provider, agent.model, agent.preset, agent.skills);
  }

  console.log(`\n  ${c.bold}Ready!${c.reset} Run ${c.cyan}${c.bold}gossipcat${c.reset} to start chatting.\n`);

  rl.close();
}
