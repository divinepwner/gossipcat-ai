# Project-Aware Team Initialization — Design Spec

> Per-project agent configuration with automatic team composition based on project type, directory signals, and available API keys. Teams evolve as projects change.

## Problem

Today, gossipcat uses a single global `.gossip/config.json` for all projects. A game project and an API project get the same agents with the same skills. This leads to:

- Security auditors dispatched for game projects (waste)
- No game-specific skills for game projects (miss)
- Users must manually configure agents for each project
- New users face a setup barrier before they can use gossipcat

The system should understand what you're building and propose the right team automatically.

## Design

### Architecture

```
User types first message in unconfigured project
    │
    ▼
handleMessage (cognitive mode) detects no .gossip/config.json
    │
    ▼
ProjectInitializer:
  1. Extract project description from user's message
  2. Scan directory for signals (package.json, Cargo.toml, etc.)
  3. Check available API keys (keychain + env vars)
  4. Send to LLM: description + signals + keys + archetype catalog
    │
    ▼
LLM picks best archetype (or blends two), adjusts roles, assigns models
    │
    ▼
Present proposed team via [CHOICES] for user approval
    │
    ▼
User approves → write .gossip/config.json with project block → proceed with task
```

### Archetype Catalog

A JSON data file shipped with gossipcat. Each archetype defines default roles, a description, and detection signals. The LLM uses this as a menu — it picks the best match and customizes.

**Location:** `data/archetypes.json` (bundled with package)

**Format:**
```json
{
  "game-dev": {
    "name": "Game Development",
    "description": "Games, interactive experiences, simulations, creative coding",
    "roles": [
      { "preset": "implementer", "focus": "game logic, rendering, mechanics" },
      { "preset": "tester", "focus": "gameplay testing, edge cases, performance" },
      { "preset": "researcher", "focus": "library discovery, reference implementations" },
      { "preset": "debugger", "focus": "frame rate issues, state bugs, input handling" }
    ],
    "signals": {
      "keywords": ["game", "player", "score", "level", "sprite", "canvas", "render"],
      "files": ["*.game.*", "assets/", "levels/"],
      "packages": ["phaser", "pixi.js", "three.js", "pygame", "godot", "blessed"]
    }
  }
}
```

**19 Archetypes:**

| Archetype | Roles | Best For |
|-----------|-------|----------|
| `solo-builder` | implementer, tester | CLIs, scripts, small libs, prototypes, POCs |
| `full-stack` | architect, implementer, reviewer, tester | Full-stack web, SaaS, e-commerce, admin panels |
| `api-backend` | architect, implementer, security-reviewer, tester | REST/GraphQL APIs, microservices, serverless, real-time servers |
| `frontend-craft` | implementer, reviewer (UX), tester (E2E) | SPAs, static sites, browser extensions, PWAs, design systems |
| `mobile-app` | implementer, tester (device), reviewer, researcher | React Native, Flutter, Swift, Kotlin apps |
| `data-research` | researcher, implementer, tester | ML/AI training, data pipelines, ETL, analytics |
| `llm-ai-app` | implementer, researcher, tester, reviewer | RAG systems, chatbots, agents, prompt engineering |
| `game-dev` | implementer, tester, researcher, debugger | Web/terminal/engine games, simulations |
| `security-ops` | security-auditor, reviewer, tester, researcher | Pen testing, vulnerability research, compliance audits |
| `systems-infra` | architect, implementer, debugger, tester | Libraries/SDKs, compilers, database engines, desktop apps |
| `devops-platform` | architect, implementer, security-reviewer, tester | Terraform, K8s, Docker, CI/CD, cloud infrastructure |
| `migration-rewrite` | architect, reviewer, implementer, tester | Framework upgrades, language migrations, legacy rewrites |
| `docs-content` | researcher, reviewer, implementer | Documentation, technical writing, tutorials, content sites |
| `monorepo-enterprise` | architect, implementer, reviewer, tester, researcher | Large codebases, multi-package repos, enterprise platforms |
| `ecommerce-fintech` | architect, implementer, security-reviewer, tester, reviewer | Payment systems, trading platforms, banking — compliance-critical |
| `realtime-collab` | architect, implementer, tester, debugger | WebSocket apps, multiplayer, collaborative editors, chat systems |
| `hardware-embedded` | implementer, debugger, tester, researcher | IoT firmware, Arduino/RPi, drivers, RTOS |
| `open-source-lib` | architect, reviewer, tester, researcher | Public packages, SDKs, frameworks — API design + backwards compat |
| `blockchain-web3` | architect, implementer, security-auditor, tester | Smart contracts, dApps, DeFi, NFT platforms, chain indexers |

### Signal Detection

When the orchestrator runs in a directory with existing code, it scans for signals to suggest the right archetype without asking:

**Directory scanner checks:**
- `package.json` → extract dependencies, scripts, name
- `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml` → language detection
- `tsconfig.json`, `.eslintrc`, `jest.config` → tooling signals
- `Dockerfile`, `docker-compose.yml`, `terraform/`, `.github/workflows/` → devops signals
- `contracts/`, `hardhat.config`, `foundry.toml` → blockchain signals
- `assets/`, `sprites/`, `levels/` → game signals
- Existing `.gossip/` directory structure

**Signal matching:**
1. Collect all signals (files found, packages detected, keywords from description)
2. Score each archetype by signal overlap
3. Pass top 3 candidates + all signals to LLM
4. LLM makes final pick with reasoning

### Config Generation

The generated `.gossip/config.json` includes a new `project` block:

```json
{
  "main_agent": {
    "provider": "google",
    "model": "gemini-2.5-pro"
  },
  "project": {
    "description": "Terminal snake game in TypeScript",
    "archetype": "game-dev",
    "initialized": "2026-03-24T12:00:00Z"
  },
  "agents": {
    "gemini-implementer": {
      "provider": "google",
      "model": "gemini-2.5-pro",
      "preset": "implementer",
      "skills": ["typescript", "implementation", "game_logic", "terminal_rendering"]
    },
    "gemini-tester": {
      "provider": "google",
      "model": "gemini-2.5-pro",
      "preset": "tester",
      "skills": ["testing", "debugging", "gameplay_testing"]
    },
    "gemini-researcher": {
      "provider": "google",
      "model": "gemini-2.5-flash",
      "preset": "researcher",
      "skills": ["research", "documentation", "library_discovery"]
    }
  }
}
```

**Backwards compatible:** Existing configs without `project` block continue to work. The `project` block is optional and only written by the init flow.

**Project-specific skills:** The LLM adds skills like `game_logic`, `terminal_rendering` that go beyond the generic preset skills. These improve task routing — when the user says "fix the rendering bug", the orchestrator routes to the agent with `terminal_rendering` skill.

### Model Assignment

The LLM assigns models based on available API keys and role requirements:

- **Heavy thinking roles** (architect, security-auditor) → strongest available model
- **High-volume roles** (implementer, tester) → balanced model (good + fast)
- **Light roles** (researcher) → cheapest available model

If only one provider is available, all agents use that provider with model tiers:
- Google only: `gemini-2.5-pro` for heavy, `gemini-2.5-flash` for light
- Anthropic only: `claude-sonnet-4-6` for heavy, `claude-haiku-4-5` for light
- Mixed: best model per role across providers

### Team Evolution

Three mechanisms for team changes during project development:

#### 1. Explicit request via `update_team` tool

The cognitive orchestrator has an `update_team` tool:

```
update_team(action: "add" | "remove" | "modify", agent_id?: string, config?: {...})
```

User says "add a security reviewer" → LLM calls `update_team(action: "add", config: { preset: "reviewer", skills: ["security_audit"] })` → presented via `[CHOICES]` → user approves → config updated → worker started.

User says "remove the researcher, I don't need it" → LLM calls `update_team(action: "remove", agent_id: "gemini-researcher")` → confirmed → config updated → worker stopped.

**All team changes require user approval.** Never auto-modify.

#### 2. Skill gap detection (automatic)

When the orchestrator routes a task and no agent has the required skills:

```
User: "audit this for SQL injection"
    │
    ▼
Orchestrator: no agent has security_audit skill
    │
    ▼
[CHOICES]:
  "None of your agents specialize in security. Options:
   - [Add agent] Add gemini-security (security_audit, vulnerability_research)
   - [Dispatch anyway] Send to gemini-reviewer (closest match)
   - [Skip]"
```

Builds on existing `skill-gap-tracker` which logs gaps to `.gossip/skill-gaps.jsonl`.

#### 3. Scope change detection

The `project.description` in config is compared against recent conversation context. If the orchestrator detects significant divergence:

```
"Your project seems to have expanded (now includes backend API work).
 Want me to re-evaluate your team?"
   - [Re-evaluate] Propose updated team
   - [Keep current] No changes
```

Lightweight check — only triggered when the orchestrator can't route a task well, not on every message.

### Integration with Cognitive Orchestration

The project init flow integrates with the cognitive orchestration spec (2026-03-24):

1. `handleMessage` in cognitive mode checks for `.gossip/config.json` before routing
2. If missing → `ProjectInitializer.init()` runs instead of normal tool routing
3. The `init_project` and `update_team` tools are added to the tool definitions
4. The LLM system prompt includes: "If no project is configured, use `init_project` to set up the team first."

### Entry Points

| Entry Point | When | What Happens |
|-------------|------|-------------|
| First message in new project | Auto | Cognitive mode detects no config, triggers init |
| `/init` CLI command | Explicit | Re-run init flow (overwrite existing config after confirmation) |
| `gossip_setup` MCP tool | Programmatic | Direct config write (existing, unchanged) |
| `create-team` CLI command | Explicit | Existing AI-powered setup (enhanced to use archetypes) |
| Skill gap detected | Auto | Suggest adding an agent |
| Scope change detected | Auto | Suggest re-evaluating team |

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/archetype-catalog.ts` | **Create** | Load/parse archetype catalog, score signal matches |
| `packages/orchestrator/src/project-initializer.ts` | **Create** | Detect missing config, scan directory, propose team via LLM, write config |
| `packages/orchestrator/src/team-manager.ts` | **Create** | Add/remove/modify agents, skill gap → team suggestion, scope change detection |
| `packages/orchestrator/src/tool-definitions.ts` | **Modify** | Add `init_project`, `update_team` tools |
| `packages/orchestrator/src/tool-router.ts` | **Modify** | Add handlers for `init_project`, `update_team` |
| `packages/orchestrator/src/main-agent.ts` | **Modify** | Check for missing config in cognitive mode, trigger init |
| `packages/orchestrator/src/types.ts` | **Modify** | Add `ProjectConfig`, `Archetype`, `TeamChangeAction` types |
| `data/archetypes.json` | **Create** | 19 archetype definitions with signals |
| `tests/orchestrator/project-initializer.test.ts` | **Create** | Init flow tests |
| `tests/orchestrator/team-manager.test.ts` | **Create** | Team evolution tests |
| `tests/orchestrator/archetype-catalog.test.ts` | **Create** | Signal matching tests |

## Review Findings & Resolutions

Spec reviewed by 4-agent Gemini consensus + Claude architect subagent.

### Resolved: Original task lost after init approval (Critical)

**Problem:** "build a snake game" is both the init trigger AND the user's task. After the init flow completes (propose team → user approves → write config), the original task is dropped. `handleChoice` returns "Team ready!" but never executes "build a snake game".

**Resolution:** `ProjectInitializer` stores the original message in `pendingTask`. After config is written and workers started, `handleMessage` automatically re-invokes itself with the stored message:

```typescript
// In handleMessageCognitive, after init completes:
if (this.projectInitializer.pendingTask) {
  const task = this.projectInitializer.pendingTask;
  this.projectInitializer.pendingTask = null;
  return this.handleMessageCognitive(task); // Re-process original message
}
```

### Resolved: No worker hot-start from orchestrator layer (Critical)

**Problem:** `Keychain` lives in `apps/cli`, but `ProjectInitializer` lives in `packages/orchestrator`. After writing config, there's no way to start workers because the orchestrator layer can't access API keys.

**Resolution:** `MainAgent` accepts a `keyProvider: (provider: string) => Promise<string>` callback in its config. The CLI layer passes the Keychain lookup. `ProjectInitializer` and `TeamManager` use this callback to get keys when starting new workers. The existing `syncWorkersViaKeychain` pattern in `mcp-server-sdk.ts` already does this — we generalize it:

```typescript
// MainAgentConfig gets:
keyProvider?: (provider: string) => Promise<string>;

// CLI passes:
new MainAgent({ ..., keyProvider: (p) => keychain.get(p) });

// ProjectInitializer uses it after writing config:
await this.mainAgent.syncWorkers(); // uses keyProvider internally
```

### Resolved: `update_team remove` has no in-flight task protection (High)

**Problem:** Removing an agent while it has in-flight tasks leaves `collect()` hanging indefinitely. No `stopWorker(id)` API exists.

**Resolution:**
1. Add `stopWorker(agentId: string)` to `MainAgent` — stops the worker and removes from workers map
2. Before stopping, check for in-flight tasks via `pipeline.getActiveTasks(agentId)`
3. If active tasks exist, present `[CHOICES]`:
   ```
   "gemini-researcher has 2 active tasks. Options:
    - [Wait and remove] Let tasks finish, then remove agent
    - [Force remove] Cancel tasks and remove immediately
    - [Cancel] Keep agent"
   ```
4. "Wait and remove" collects pending tasks first, then stops worker
5. "Force remove" marks pending tasks as failed with reason "agent removed"

### Resolved: User rejects team → no escape path (High)

**Problem:** If the user rejects the proposed team, the session has no config and no workers. Next message loops back into init or fails.

**Resolution:** Three reject options:

```
"I've proposed a team for your project. Options:
 - [Accept] Start with this team
 - [Modify] Adjust roles or models
 - [Manual setup] Use the setup wizard instead
 - [Skip] Chat without agents (limited to direct LLM answers)"
```

- **Modify:** Clear pendingInit, return "Describe what you'd like to change" — next message re-triggers init with modifications
- **Manual setup:** Return instructions to run `gossipcat setup` CLI command
- **Skip:** Set a `noAgents` flag. Cognitive mode works but all tool calls that need agents return "No agents configured. Run /init to set up your team." The user can still chat directly with the LLM.

### Resolved: Signal scanner security (Medium)

**Problem:** Directory scanning could follow symlinks outside project root. Scan depth is unbounded on large repos.

**Resolution:**
1. All scanned paths resolved to absolute and checked within `projectRoot` (same pattern as Smart Dispatch Enrichment)
2. No symlink following — use `lstatSync` to detect symlinks, skip them
3. Scan depth bounded to 2 levels from project root
4. Only check existence of known signal files (no recursive glob) — `package.json`, `Cargo.toml`, etc.
5. Directory checks (`assets/`, `contracts/`) only at project root level

### Resolved: Data exfiltration from directory scan (Medium)

**Problem:** Contents of `package.json` and other files are sent to the LLM for archetype matching.

**Resolution:** Only send **signal summaries**, not full file contents:
- From `package.json`: dependency names only (no versions, no scripts, no private fields)
- From `Cargo.toml`: crate names only
- From directory scan: directory names that exist, not their contents
- Present the signals to the user before sending: "I detected: TypeScript project, dependencies: react, next, prisma. Sending to LLM to configure your team. OK?"

### Resolved: Relationship to existing setup tools

- **`setup-wizard.ts`:** Coexists. Simplified to focus on global API key configuration only. Agent creation portion becomes less relevant.
- **`create-team.ts`:** Superseded by the new init flow. Kept for backwards compatibility but deprecated. The archetype-based init is strictly more capable.

### Deferred: Polyglot repository handling

Monorepos with multiple languages/frameworks may get ambiguous signal scores. For MVP, the LLM picks the dominant archetype based on the user's description (which is the strongest signal). The user can always modify. A future enhancement could detect sub-projects and suggest per-directory configs.

## Decisions

1. **Archetype catalog is data (JSON), not code** — extensible without code changes
2. **LLM picks archetype + customizes** — handles edge cases, blends archetypes
3. **First message triggers init** — no separate setup step, hybrid approach (prompted, not forced)
4. **Team changes always require user approval** — never auto-modify config
5. **`project` block in config is optional** — backwards compatible
6. **19 archetypes as starting catalog** — comprehensive but not exhaustive, community can extend
7. **Model assignment by role weight** — heavy thinkers get best model, light roles get cheap model
8. **Skill gap detection suggests team changes** — builds on existing skill-gap-tracker
9. **Scope change detection is lightweight** — only when routing fails, not every message
10. **Original task re-processed after init** — `pendingTask` stored and re-invoked after setup completes
11. **`keyProvider` callback** — bridges CLI keychain to orchestrator layer for worker hot-start
12. **In-flight task protection** — agents can't be removed while tasks are active without explicit user choice
13. **Skip option on reject** — user can chat without agents, not forced into setup loop
14. **Signal summaries only** — no full file contents sent to LLM, user confirmation before sending
