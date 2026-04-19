---
status: proposal
---

# AST cross-reference + context compaction — grounded xref & four compaction levers

## Problem

Two pressures converge on the same architectural gap.

**Analysis grounding ceiling.** Verifier agents in `consensus-engine.ts` today
check citations by re-reading files and grepping. That catches "does this line
exist and say X?" but not "is this function actually called from where the
finding claims?" or "does untrusted input reach this sink?". The grounding
surface is file+line, not semantic. Structural claims — call graphs, data flow,
reachability — are currently graded the same way as taste claims: through more
LLM reading. Invariant #1 (grounded verification) stops one step short of what
the code itself can answer deterministically.

**Context cost.** A typical consensus round pays ~20–30k tokens per agent
(handbook + skills + full-file deliveries + history). Three agents per round ×
N rounds per day = the dominant cost line. Prompt caching is **not currently
used** anywhere in `packages/orchestrator/src` (grep `cache_control` → 0
matches). Static prefix tokens (handbook, FINDING_TAG_SCHEMA, persistent
skills) are paid full price on every dispatch.

These two pressures share one solution: **semantic understanding of code.** An
AST index unlocks both deterministic structural verification *and*
slice-based context compaction. Neither lever works well alone — slice needs
AST, caching ROI is limited without slice shrinking the dynamic blob.

## Proposed design

Five coupled deliverables. Order is load-bearing — each step reduces risk for
the next.

### 1. AST cross-reference index (foundation)

Multi-language via `tree-sitter`. Start grammars: TypeScript/JavaScript,
Python, Go, Rust. Others added on demand.

**Index contents per file:**
- Function/method definitions: `{name, kind, file, startLine, endLine, signature, docComment}`
- Call sites: `{caller, callee, file, line, callType: direct|method|dynamic}`
- Module imports: `{module, symbols, file, line}`

**Storage:** `.gossip/xref/` — per-file JSON keyed by file path. Index header
records `{treeSitterVersion, grammarVersions, indexedAt}` for validation.

**Lifecycle — hybrid incremental:**
- First run: full repo parse.
- Subsequent dispatches: `git diff --name-only` against last-indexed commit.
  Changed files re-parsed, rest served from cache.
- Dirty working tree: dirty files always re-parsed, tree-clean files cached.
- Grammar version bump: full reindex.

**Failure mode:** parse error on a file → record `{error, partial: true}` in
that file's entry; do not abort index. Verifiers that ask for xref on a
partial file get an explicit `context_confidence: low` signal.

### 2. `xref` verifier tool

New entry in `VERIFIER_TOOLS` (`consensus-engine.ts:59`). Three operations:

- `xref.calls_of(symbol)` → list of `{file, line}` call sites
- `xref.callers_of(symbol)` → list of `{file, line}` where symbol is called
- `xref.defined_at(symbol)` → `{file, startLine, endLine, signature}` or null

Verifier model can now deterministically check structural claims:
> Finding: "`validateInput` is never called"
> Verifier: `xref.callers_of("validateInput")` → returns empty → CONFIRMED
> Or: returns 3 sites → DISPUTED with evidence

This extends invariant #1 to structural claims without introducing
LLM-as-judge. Reality has ground truth; the parser is the judge.

### 3. Slice-based context delivery

When a dispatch targets specific files/functions, the prompt assembler
(`prompt-assembler.ts`) consults the xref index and assembles a **neighborhood
slice** instead of full files:

- **Target function(s)** — full body
- **Direct callers (radius 1)** — signature stubs only (name + params + return
  type + 1-line doc if present)
- **Direct callees (radius 1)** — signature stubs only
- **Imports used** — resolved line ranges, signature stubs
- **Siblings in the same file** — names in a collapsed list, not bodies

Agent can request expansion via a new tool `expand_symbol(name)` — returns the
full body of any stub in the current slice. Budget: max 3 expansions per
dispatch; a 4th falls back to full-file delivery and records a MetaSignal
`slice_insufficient`.

### 4. Prompt caching discipline

Anthropic prompt caching applied to two distinct prefix blocks:

- **Block A — repo-agnostic static:** FINDING_TAG_SCHEMA, CONSENSUS_OUTPUT_FORMAT,
  handbook excerpt. Identical across all repos and agents. Cache long TTL.
- **Block B — repo + agent static:** agent instructions, loaded skills for
  this agent, repo identity/path. Identical across dispatches for the same
  (agent, repo) pair. Cache medium TTL.
- **Block C — dynamic (not cached):** task description, slice payload, prior
  consensus references.

**Deterministic prefix builder.** Caching requires byte-identical prefixes.
Add a `PrefixBuilder` that produces blocks A and B with stable ordering:
skills sorted by canonical name, schemas rendered from template with no
date/random strings, no trailing whitespace drift. Any non-determinism is a
bug that silently costs tokens.

### 5. Cross-agent prefix sharing within consensus rounds

Within a single consensus round, block A is identical across all participating
agents. Block B differs by agent. The `ConsensusCoordinator` already knows the
agent set for a round — it can declare block A once, and per-agent dispatches
reference the same cache key.

This is not a second mechanism — it is the natural consequence of block A
being agent-agnostic. Declared explicitly here because it requires the
coordinator to thread a shared `cacheKeyId` through each agent's dispatch.

**Isolation invariant:** only repo-agnostic content enters block A. An agent's
skills, personality prompt, or score history **never** enter a cross-agent
shared block — that would leak and poison the scoring pipeline. Enforced by
the `PrefixBuilder` API (separate functions for each block, no mixing).

## What stays unchanged

- `FINDING_TAG_SCHEMA` parser strictness (invariant #8) — untouched.
- Consensus Phase 2/3 semantics (`consensus-engine.ts`) — unchanged; xref is
  additive to the verifier toolbox.
- Dispatch pipeline signal emission (`dispatch-pipeline.ts`) — unchanged;
  slice/caching are pre-dispatch concerns.
- Skill loader (`skill-loader.ts`) — unchanged.
- `MIN_EVIDENCE = 120` (invariant #2) — untouched.
- Two-item content split for native dispatch (invariant #4) — untouched; the
  slice lives inside item 2 (the agent prompt).

## Non-goals

- **No LLM-as-judge layer.** Xref results are mechanical. If a finding can't
  be confirmed or disputed by xref, it stays UNVERIFIED. We do not ask an LLM
  to grade xref output.
- **No runtime / dynamic analysis.** Taint/data-flow is a future spec;
  deliberately out of scope to keep this shippable.
- **No full-repo vectorization / embedding index.** Token-cheap keyword +
  structural match is sufficient for verifier needs. Embeddings add ops
  surface without clear ROI at current scale.
- **No minification of source files for context.** Would break file:line
  citations and invariant #1. Slice is focus, not compression.
- **No eager reindex on watcher.** Parse is triggered by dispatch, not a
  background daemon. Keeps it zero-ops.

## Risks

1. **Cache key fragility.** Any non-determinism in block A or B silently
   misses cache. Mitigation: golden-fixture test that renders a block twice
   and asserts byte equality; CI fails on drift.
2. **Slice completeness.** Dynamic dispatch, reflection, string-based method
   lookup escape static xref. Mitigation: agents see `context_confidence`
   field; low confidence → `expand_symbol` budget doubles, finding type can
   fall back to INCONCLUSIVE rather than hallucinated certainty.
3. **Grammar version drift.** tree-sitter grammar updates change node names →
   silent indexer breakage. Mitigation: grammar version pinned in
   `.gossip/xref/_header.json`, mismatch triggers full reindex + one-line
   stderr log.
4. **Cross-agent cache contamination.** A single agent-specific string
   leaking into block A poisons all round participants' scoring. Mitigation:
   `PrefixBuilder.blockA()` typed to accept only a fixed allowlist of
   content; no free-form string parameter.
5. **Tool surface bloat.** Adding `xref.*` and `expand_symbol` grows the
   verifier tool list → attention drain on the model. Mitigation: verifier
   prompt template lists xref tools in a dedicated "structural verification"
   section, separate from file-read tools, so the model organizes them.

## Phased delivery

Each phase is a standalone PR, measurable on its own.

**Phase 1 — AST index + xref tool (foundation).** Ships index builder,
incremental cache, and the three xref verifier tools. No prompt-side change.
Success metric: xref calls on verified findings correctly classify CONFIRMED
vs DISPUTED on a curated test set of ≥30 structural findings.

**Phase 2 — Prompt caching.** Independent of xref. Just block A/B
declaration + `PrefixBuilder`. Biggest single-PR ROI. Success metric:
`cache_hit_tokens` meta-signal on ≥80% of dispatches shows non-zero hits;
billable token count drops ≥40% on consensus rounds.

**Phase 3 — Slice delivery.** Requires Phase 1. Prompt assembler consults
xref, builds neighborhood slice, exposes `expand_symbol`. Success metric:
slice_reduction meta-signal averages ≥30% vs full-file baseline; agent
accuracy (measured via signal pipeline) does **not** regress (non-inferiority
test on same workload).

**Phase 4 — Cross-agent prefix sharing.** Requires Phase 2. Coordinator
threads shared cacheKeyId. Success metric: per-round cumulative billable
tokens drop ≥50% vs Phase 2 baseline on 3-agent rounds.

## Measurement — `context_composition` MetaSignal

New MetaSignal recorded on every dispatch:

```
{
  cache_hit_tokens: number,
  cache_miss_tokens: number,
  slice_reduction_ratio: number,   // 0..1, fraction of full-file bytes omitted
  expansions_requested: number,
  context_confidence: "high" | "medium" | "low",
  cross_agent_shared_blockA: boolean
}
```

Surfaced in dashboard as a per-round composition bar. Per invariant #8, this
signal is **loud** — always emitted, diagnostic codes exposed.

## Implementation estimate

| Phase | Prod LOC | Test LOC | External deps |
|-------|----------|----------|---------------|
| 1. AST index + xref tool | ~800 | ~400 | `tree-sitter`, 4 grammar packages |
| 2. Prompt caching | ~250 | ~150 | none (SDK already supports) |
| 3. Slice delivery | ~500 | ~300 | none |
| 4. Cross-agent sharing | ~150 | ~100 | none |
| **Total** | **~1700** | **~950** | |

Phases 1 and 2 are parallelizable — different files, no shared state. Phase 3
blocks on 1, Phase 4 blocks on 2.

## Open questions

1. **tree-sitter runtime vs native bindings?** WASM grammars are portable but
   slower; native bindings are faster but complicate postinstall. Pick during
   Phase 1 implementation.
2. **LSP fallback?** For TypeScript specifically, `tsserver` already computes
   the xref we want. Cheap to call, saves a grammar. Worth a small spike in
   Phase 1 before committing to tree-sitter-only.
3. **Xref for user repos with no `.gossip/`?** Index path needs to live
   somewhere writable — `.gossip/xref/` is fine if gossipcat is initialized.
   For one-shot reviews without init, consider `/tmp/gossipcat-xref-<hash>/`
   with TTL.
4. **Does slice delivery play well with the two-item dispatch split
   (invariant #4)?** The slice must land in item 2, unadorned. Confirm
   assembler never leaks xref metadata into item 1's orchestrator block.

## References

- `packages/orchestrator/src/consensus-engine.ts:59` — `VERIFIER_TOOLS` list
  (xref tool insertion point).
- `packages/orchestrator/src/consensus-engine.ts:650` — verifier invocation
  site.
- `packages/orchestrator/src/dispatch-pipeline.ts` — signal emission
  (MetaSignal writer for `context_composition`).
- `packages/orchestrator/src/prompt-assembler.ts` — slice/caching integration
  point.
- `packages/orchestrator/src/llm-client.ts` — Anthropic SDK call site for
  `cache_control` attachment.
- `packages/orchestrator/src/skill-loader.ts` — deterministic skill ordering
  for cache key stability.
- `apps/cli/src/mcp-server-sdk.ts` — MCP tool registration (`gossip_xref`
  public surface if exposed).
- `docs/HANDBOOK.md` — invariants #1 (grounded verification), #4 (two-item
  split), #8 (strict schemas, loud drops).
