# Emergent Skill Engine

**Status:** spec — ready to implement
**Date:** 2026-04-09
**Authors:** orchestrator + consensus rounds (sonnet-reviewer × 3, opus-implementer × 2, haiku-researcher × 2)
**Closes:** `project_smart_contract_skill_taxonomy.md`

## Motivation

The current skill engine has 8 hardcoded categories (`trust_boundaries`, `injection_vectors`, `concurrency`, `type_safety`, `data_integrity`, `resource_exhaustion`, `input_validation`, `error_handling`) shaped for web/TS code review. Smart-contract auditors, ML platform teams, embedded firmware consultants, healthcare EHR integrators, and the other ~9 personas gossipcat targets cannot meaningfully use this taxonomy — `reentrancy` becomes `concurrency`, `phi-redaction` has no home at all, and the skill names land as web-app nouns regardless of project domain.

The user wants the skill engine to be **emergent**: profile a project (consensus history, signals, memories, codebase) and synthesize per-agent named skills automatically, rather than shipping hand-curated verticals. The north-star example came from a real orchestrator session on a Solidity audit project, which produced per-agent proposals like `protocol-modeling` (permanent gate for `solidity-auditor`), `writer-enumeration` (permanent gate for `static-analyzer`), `exploit-chaining` (contextual for `dynamic-tester`).

## Key insight (load-bearing)

`packages/orchestrator/src/performance-reader.ts:25-28` already stores `categoryStrengths: Record<string, number>` — **the scoring pipeline is not enum-constrained**. The hardcoded enum only lives in 4 keyword/regex tables (`skill-engine.ts:36-43`, `skill-loader.ts:14-21`, `category-extractor.ts:7-14`, `dispatch-differentiator.ts:11-18`) and one filename constraint (`skill-engine.ts:217` uses `normalizeSkillName(category)` as the filename key — capping each agent at one skill per category).

Taxonomy expansion is therefore **additive at the edges**, not a core refactor.

## Design principles

1. **Skills have concrete names** (`layerzero-oft-semantics`), not category buckets. The name is the bind handle.
2. **Three skill modes:**
   - `permanent` — methodology gate, refuses to emit findings until discipline satisfied
   - `contextual` — domain knowledge injected when keywords match
   - `calibration` — meta-skill about severity/dispute/framing
3. **Per-agent, not per-project.** Each agent gets skills tailored to their role AND observed failure pattern.
4. **Derived from reading consensus history.** Back-propagate from misses: "this miss would have been caught by `writer-enumeration`."
5. **Cross-cutting allowed** via `categories: string[]` — one skill can claim multiple categories.
6. **Leverage-tiered.** Profiler proposes ~20, surfaces top 3.
7. **Validators run at the earliest possible point**, never at bind time. Late validation lets bad state leak to disk and humans.
8. **Human-in-the-loop is an interactive question, not a stdout dump.** Structured prompts beat skim-and-approve.

## Open questions resolved

| ID | Question | Answer |
|---|---|---|
| **D1** | Namespace categories (`core:concurrency`, `sc:reentrancy`)? | **No.** Flat strings stay. Add `categories: string[]` frontmatter array for cross-cutting expressiveness. Namespacing would orphan historical signal rows (`performance-reader.ts:25-28` keys are persistent in `agent-performance.jsonl`); migration cost ~5x for no MVP benefit. |
| **D2** | Profiler cadence? | **On-demand + auto-nudge from `collect.ts`.** No cron. Profile when fresh signals exist AND a human is present. Compliance personas can add `profile_schedule` config later. |
| **D3** | Step order? | **PR A → PR B → PR C.** PR A is profiler + reserved-names (atomic, no disk write path). PR B unblocks binding. PR C adds verification gates. See PR scoping below. |

## Critical holes found in consensus + fixes

Three independent consensus rounds caught three load-bearing holes; all are fixed in the PR scoping below.

### Hole 1 — Null evidence promotes to permanent (sonnet)

**Problem:** PR C's contextual trial-bind runs for N=3 dispatches. If none of those dispatches touch the skill's category, the delta is `0/0`. `resolveVerdict` has no `INCONCLUSIVE` branch — silence resolves to PASS or FAIL. A "silently passed" contextual skill flips to permanent, and `permanent` is exempt from `TIMEOUT_MS` per PR C, so **null evidence becomes a write-only path into the permanent skill registry**.

**Fix:** trial-bind verdict requires `correct + hallucinated >= K` in the target category before resolving. If K is unmet after N dispatches, return `INCONCLUSIVE` (verdict state already exists in `check-effectiveness.ts`). Never bind from silence.

**Bonus fix in same area:** `cluster_density = min(1.0, n/3)` ranks one critical miss below three medium nits. Severity-gate the floor: `cluster_density = severity >= high ? 1.0 : min(1.0, n/3)`.

### Hole 2 — Reserved names leak before bind validator runs (haiku)

**Problem:** PR A profiler emits `SkillProposal[]` with LLM-generated `skill_name` to stdout AND `.gossip/proposals/<session-id>.json`. The reserved-names allowlist runs at bind time. So the profiler can emit `health-data-masking` as a paraphrase of `phi-redaction`, the reviewer sees it in the dashboard, the proposal file persists for 30 days, and it ends up in git history. **HIPAA auditors read git history.**

**Fix:** reserved-names validator runs at proposal-assembly time, **before stdout/persist**. Drop rejected proposals before they leave memory. Emit a `proposal_rejected` signal with the category but **not** the paraphrased name.

### Hole 3 — Calibration self-consensus has no prior art (opus)

**Problem:** PR C's original design proposed `calibration` mode skills be verified by "dispatching a consensus round on the skill markdown file." There is **zero prior art** in `consensus-engine.ts` for reviewing prose; consensus operates over findings produced from code-review tasks with file/line citations. Reviewers strong in the category rubber-stamp; weak reviewers can't judge; citation_grounding fails because it's prose. The mechanism doesn't exist and would require extending consensus to a non-code target.

**Fix:** drop self-consensus calibration entirely. `calibration` mode uses the **same trial-bind + signal-delta path** as `contextual`, just with different thresholds (calibration measures `severity_miscalibrated` rate decline, contextual measures `categoryAccuracy` improvement). Both reuse `check-effectiveness.ts` + `performance-reader.ts:356-414`. Zero new dispatch infrastructure.

## Interactive validation step (the human-in-the-loop layer)

For each proposal flagged `top_n_flag: true` (top 3 per profile invocation), the orchestrator surfaces a structured question:

> I'm proposing **`writer-enumeration`** (mode: `permanent`) for `static-analyzer`.
> **Rationale:** Round `82a3c123` had a tSC-single-writer miss that this gate would have caught.
> **Source findings:** `82a3c123:f9`, `99f15984:f5`
> Does this name fit?
> - ✅ Approve
> - ✏️ Rename to: `_____`
> - 🚫 Reject (too broad / too narrow / wrong agent / not real pattern / duplicate of: `_____`)
> - ⏸ Defer (decide later)

### Why this matters

1. Catches project-specific reserved-name misses the global allowlist won't have.
2. Generates training signal that closes the synthesis loop (next profiler run incorporates prior judgments).
3. Cognitive engagement is real; skim-and-approve on a JSON dump is not.
4. Solves Hole 1 from a different angle — even if signal counters stay null, an explicit human approval is independent evidence.

### Persona-specific holes found and fixed (final consensus round)

| Hole | Fix |
|---|---|
| **Pipeline pollution** — `proposal_*` signals in `agent-performance.jsonl` get dropped silently by the `s.type === 'consensus'` filter at `performance-reader.ts:171` | New file `.gossip/proposal-feedback.jsonl` with its own reader. Never share the JSONL with the scoring pipeline. |
| **Decay-window pollution** — even if the type filter is bypassed, proposal signals bump `taskCounter` and shift the **50-task decay window**, silently aging out an agent's real accuracy history | Same fix: separate file. The two readers never cross. |
| **One-way rejection trap** — one misclick rejecting a name as `too_broad` permanently suppresses a valid pattern | Mirror the existing `signal_retracted` path at `readSignalsRaw:177-186`. Add `proposal_rejection_retracted { proposal_id }` so rejections can be reopened. |
| **Top-N gate is wrong-shape** — `top_n per agent × profile-all = 300 blocking prompts` | Gate is `top_n per invocation`, not per agent. ~5 LOC change. |
| **Consent laundering** — approvals that create positive signals make rubber-stamping look like engagement | **Approvals are silent.** Only renames and rejections create training signal. Engagement is measured downstream by whether the bind held against real category signals. |

## SkillProposal schema

```ts
interface SkillProposal {
  proposal_id: string;              // crypto.randomUUID()
  agent_id: string;
  skill_name: string;               // kebab-case, concrete: 'layerzero-oft-semantics'
  mode: 'permanent' | 'contextual' | 'calibration';
  rationale: string;                // 1-3 sentences citing source_finding_ids
  source_finding_ids: string[];     // peer confirmed finding IDs (e.g. 'b81956b2-e0fa4ea4:sonnet-reviewer:f1')
  missed_by: string[];              // agents who failed to raise these findings
  category_hint?: string;           // current taxonomy strings only — 'concurrency', 'data_integrity'
  shape: 'bullet_list' | 'rule_numbered' | 'prose_hypothesis' |
         'checklist_control' | 'invariant_counter_example';
  leverage_score: number;           // 0-1, severity-gated cluster_density
  top_n_flag: boolean;              // true for the top 3 per invocation
  conflicts_with?: string[];        // names of already-bound skills that overlap
}
```

### Leverage formula

```
leverage = severity_weight * recency * cluster_density * coverage_gap * confidence

severity_weight = max sevMul over source_findings   // reuses performance-reader.ts:55
recency         = 0.5 ^ (days_since_newest / 14)
cluster_density = severity >= high ? 1.0 : min(1.0, num_similar_misses / 3)   // severity-gated
coverage_gap    = 1 - existing_skill_overlap        // 0 if a bound skill already covers
confidence      = 1 - exp(-source_finding_ids.length / 4)
```

### ProposalSignal schema

Persisted to `.gossip/proposal-feedback.jsonl`, **never** `agent-performance.jsonl`.

```ts
type ProposalSignal =
  | { type: 'proposal_renamed';   proposal_id: string; original_name: string; new_name: string; user_note?: string; ts: string }
  | { type: 'proposal_rejected';  proposal_id: string; reason: 'too_broad' | 'too_narrow' | 'wrong_agent' | 'not_real_pattern' | 'duplicate_of'; duplicate_target?: string; user_note?: string; ts: string }
  | { type: 'proposal_deferred';  proposal_id: string; reason?: string; ts: string }
  | { type: 'proposal_rejection_retracted'; proposal_id: string; new_verdict?: 'approved' | 'deferred'; ts: string };
```

Approvals are not persisted as signals. The bind itself is the record of approval.

## PR scoping

### PR A — profiler + reserved-names + interactive validation

**Atomic. Read-only on disk except for the new feedback file.**

| Component | LOC |
|---|---|
| `packages/orchestrator/src/skill-profiler.ts` (reads `agent-performance.jsonl` only — skips `consensus-reports/*.json` per opus, severity-gated cluster_density per sonnet) | ~250 |
| Reserved-names validator at proposal-assembly time (drops rejected proposals before stdout/persist; emits `proposal_rejected` signal with category but not name) | ~20 |
| Interactive validation step (top-N **per invocation**, not per agent; surfaces structured questions) | ~80 |
| New `.gossip/proposal-feedback.jsonl` + `ProposalFeedbackReader` (separate from `PerformanceReader`) | ~60 |
| `ProposalSignal` types — rename / reject / defer / rejection_retracted only. **No `proposal_approved`.** | ~25 |
| Handler additions: `gossip_skills(action: "profile" \| "review-all-proposals" \| "archive-proposals" \| "retract-rejection")` | ~50 |
| `.gossip/proposals/` and `.gossip/proposal-feedback.jsonl` added to `.gitignore` | ~2 |
| **Total PR A** | **~487** |

**Outputs:** `SkillProposal[]` JSON to stdout AND `.gossip/proposals/<session-id>.json`. 30-day retention on proposal files, pruneable via `gossip_skills(action: "archive-proposals")`.

**No auto-binding anywhere in PR A.** Proposals are advisory. Acceptance is human-gated via the interactive validation step or via a future PR.

### PR B — multi-skill filename refactor

| Component | LOC |
|---|---|
| `skill-engine.ts:217` accepts profiler-supplied slug instead of `normalizeSkillName(category)` | ~10 |
| `categories: string[]` frontmatter field added to `parseSkillFrontmatter` at `skill-parser.ts:14-51` (single choke point per opus) | ~5 |
| Back-compat: legacy `category: foo` reads as `categories: [foo]` | ~5 |
| `mode`, `volatility`, `source_findings`, `shape` frontmatter fields | ~15 |
| Update downstream readers (`skill-loader.ts:144`, `skill-engine.ts:383`) | ~10 |
| Tests for back-compat | ~35 |
| **Total PR B** | **~80** |

**Unblocks** binding of Step 1's proposals as multi-category-tagged files.

### PR C — mode-aware verification gate

| Component | LOC |
|---|---|
| Branch `resolveVerdict` on `mode` in `check-effectiveness.ts` | ~20 |
| `permanent` mode: exempt from `TIMEOUT_MS` (fixes embedded/kernel persona brittleness) | ~10 |
| `contextual` mode: trial-bind for N dispatches + signal delta, **with sonnet's INCONCLUSIVE branch when `correct + hallucinated < K`** | ~40 |
| `calibration` mode: trial-bind + signal delta on `severity_miscalibrated` rate (NOT self-consensus per opus — drop self-consensus entirely) | ~30 |
| Tests for null-evidence handling | ~50 |
| **Total PR C** | **~150** |

### Deferred to later PRs

- **Step 5** synthesis of skill file content (only after PR A proposals are calibrated against hand-picks for ≥2 weeks)
- **Step 6** lifecycle state machine (proposed → bound → validated → active/violated/stale/retired)
- **Step 7** 4-skill-per-dispatch budget
- **Step 8** namespacing (`core:*`, `sc:*`) — only if/when a second domain actually lands

## File anchors

- `packages/orchestrator/src/skill-engine.ts:26` — `SAFE_NAME` regex (Step 4 reserved-names allowlist site)
- `packages/orchestrator/src/skill-engine.ts:28-32` — `KNOWN_CATEGORIES` enum (D1: stays flat)
- `packages/orchestrator/src/skill-engine.ts:36-43` — keyword map #1
- `packages/orchestrator/src/skill-engine.ts:103` — `generate()` entry point
- `packages/orchestrator/src/skill-engine.ts:217` — `normalizeSkillName(category)` filename constraint (PR B refactor target)
- `packages/orchestrator/src/skill-engine.ts:382-385` — `loadCategoryFindings` filter (currently `category_confirmed` only — widen to include hallucination_caught + disagreement)
- `packages/orchestrator/src/skill-engine.ts:402` — `checkEffectiveness` (PR C branch site)
- `packages/orchestrator/src/skill-engine.ts:505-508` — `migrateIfNeeded` TIMEOUT_MS reset (permanent mode must skip)
- `packages/orchestrator/src/skill-loader.ts:14-21` — keyword map #2
- `packages/orchestrator/src/category-extractor.ts:7-14` — keyword map #3
- `packages/orchestrator/src/dispatch-differentiator.ts:11-18` — keyword map #4
- `packages/orchestrator/src/performance-reader.ts:25-28` — `categoryStrengths: Record<string, number>` (already string-keyed)
- `packages/orchestrator/src/performance-reader.ts:55` — `SEVERITY_MULTIPLIER` (reuse for leverage formula)
- `packages/orchestrator/src/performance-reader.ts:131-155` — `getCountersSince`
- `packages/orchestrator/src/performance-reader.ts:163` — `readSignalsRaw`
- `packages/orchestrator/src/performance-reader.ts:171` — **`s.type === 'consensus'` filter — DO NOT add proposal signals here**
- `packages/orchestrator/src/performance-reader.ts:177-186` — `signal_retracted` prior art (mirror for `proposal_rejection_retracted`)
- `packages/orchestrator/src/performance-reader.ts:283-292` — `ensure(signal.agentId)` decay-window bumper (the reason proposal signals must NEVER share the JSONL)
- `packages/orchestrator/src/performance-reader.ts:356-414` — `categoryAccuracy` aggregation (reused for trial-bind verdicts)
- `packages/orchestrator/src/skill-parser.ts:14-51` — `parseSkillFrontmatter` (single back-compat choke point)
- `packages/orchestrator/src/check-effectiveness.ts` — VerdictStatus / TIMEOUT_MS / `INCONCLUSIVE` state already exists
- `apps/cli/src/handlers/skills.ts` — handler additions for new `gossip_skills` actions

## Open questions deferred (not blockers)

- **Skill content synthesis** (Step 5) — when the LLM writes the actual skill markdown body, what prevents hallucinated methodology? Trial-bind + signal delta is the floor; explicit content cross-review before binding is the next-level gate. Defer until PR A/B/C land and we have real proposals to test against.
- **Cross-pollination of skills across agents** — if `bridge-semantics` is proposed for `solidity-auditor`, can `static-analyzer` also gain it? `categories: string[]` allows it structurally; the binding policy is undefined. Defer to a follow-up PR after we see real cross-cutting cases.
- **Compliance audit cadence** — healthcare EHR / fintech personas need scheduled profiler runs aligned to SOC2/HIPAA cycles. Add `profile_schedule` config in a later PR; the manual `profile` invocation satisfies audit evidence ("we ran the profiler on `<date>`") in the meantime.
- **Enterprise batch interface** — `gossip_skills(action: "profile-all")` for orgs with 100+ agents. Loop is correctness-equivalent to batch; defer until a real enterprise persona shows up.

## Verification before each PR ships

- **PR A:** profiler runs against gossipcat's own `agent-performance.jsonl`. The 5 currently-bound skills (`sonnet-reviewer/skills/*.md`) should map recognizably onto the top proposals. If they don't, the clustering is wrong and we don't ship.
- **PR B:** existing skill files at `.gossip/agents/*/skills/*.md` continue to load unchanged (back-compat test). New multi-category file loads correctly. Filename collisions with `normalizeSkillName(category)` no longer occur.
- **PR C:** `INCONCLUSIVE` branch returns when category counters are null. Permanent skills with no recent signals don't auto-stale. Calibration trial-bind measures the right delta dimension.

## What we are explicitly NOT building

- **A namespaced taxonomy.** D1 settled. Flat strings + `categories: string[]`.
- **A weekly cron.** D2 settled. On-demand + auto-nudge.
- **Self-consensus on prose.** Opus's hole. Trial-bind + signal delta only.
- **`proposal_approved` signals.** Sonnet's consent-laundering finding. Approvals are silent.
- **Shared JSONL.** Sonnet's pipeline-pollution finding. `proposal-feedback.jsonl` is its own world.
- **Hand-curated per-vertical skill packs.** The whole point of the engine is to make these obsolete.
