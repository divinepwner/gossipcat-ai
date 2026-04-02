# Cross-Review LLM Identity Fix

**Date:** 2026-04-03
**Status:** Design validated by 2-agent parallel review
**Priority:** CRITICAL — product-integrity bug

## Problem

ConsensusEngine uses a single LLM (gemini-2.5-pro) for ALL cross-review, regardless of which agent produced the findings. When sonnet-reviewer (0.73 accuracy) produces Phase 1 findings via Agent(), the Phase 2 cross-review is done by gemini (0.22 accuracy) impersonating sonnet. Result: 0 confirmed findings despite agents finding the same issues. The consensus report attributes decisions to agents that never made them.

**Root cause:** `consensus-engine.ts:233` calls `this.config.llm.generate()` for every agent's cross-review. The single `llm` is always the main agent's provider, passed in at `dispatch-pipeline.ts:866`.

## Design: Split Consensus into Resumable Phases

### Current flow (single call):
```
gossip_collect(consensus: true)
  → ConsensusEngine.run()
    → dispatchCrossReview() [gemini for ALL agents]
    → synthesize()
  → return report
```

### New flow (two calls for mixed native+relay batches):

**Call 1: gossip_collect(consensus: true)**
- Detect if batch contains native agents
- For RELAY agents: run cross-review inline via their own LLM provider (from `agentLlm` factory)
- For NATIVE agents: generate cross-review prompts but do NOT call LLM
- Return relay cross-review results + native agent prompts:
```
⚠️ NATIVE CROSS-REVIEW NEEDED:
Agent sonnet-reviewer needs to cross-review. Dispatch:
Agent(model: 'sonnet', prompt: '<cross-review prompt>')
→ then: gossip_relay_cross_review(consensus_id: 'xxx', agent_id: 'sonnet-reviewer', result: '<output>')
```

**Call 2: gossip_relay_cross_review(consensus_id, agent_id, result)**
- Parse native agent's JSON cross-review response into CrossReviewEntry[]
- Accumulate in pending consensus state
- When all native agents have responded (or timeout): concatenate relay + native entries, call synthesize() once, return final report

**Relay-only batches (no native agents):** Use existing `run()` path unchanged. Zero behavioral change for gemini-only consensus.

## Interface Changes

### ConsensusEngineConfig
```typescript
export interface ConsensusEngineConfig {
  llm: ILLMProvider;                                    // fallback default
  registryGet: (agentId: string) => AgentConfig | undefined;
  projectRoot?: string;
  agentLlm?: (agentId: string) => ILLMProvider | undefined;  // NEW — per-agent LLM for relay agents
}
```

### New ConsensusEngine methods
```typescript
// Phase 2a: Generate cross-review prompts without calling LLM
async generateCrossReviewPrompts(results: TaskEntry[]): Promise<{
  prompts: Array<{ agentId: string; system: string; user: string; isNative: boolean }>;
  summaries: Map<string, string>;
  consensusId: string;
}>

// Phase 2b+3: Synthesize with externally-provided cross-review responses
async synthesizeWithCrossReview(
  results: TaskEntry[],
  crossReviewEntries: CrossReviewEntry[],
  consensusId: string,
): Promise<ConsensusReport>
```

### New MCP tool: gossip_relay_cross_review
```typescript
gossip_relay_cross_review(
  consensus_id: string,
  agent_id: string,
  result: string,        // JSON string — the agent's cross-review response
)
```

### Pending consensus state (mcp-context.ts)
```typescript
pendingConsensusRounds: Map<string, {
  consensusId: string;
  allResults: TaskEntry[];
  relayCrossReviewEntries: CrossReviewEntry[];  // already computed in Call 1
  pendingNativeAgents: Set<string>;
  nativeCrossReviewEntries: CrossReviewEntry[];  // accumulates from Call 2
  deadline: number;  // timeout timestamp
}>
```

## Files to Modify

### Core consensus engine
- `packages/orchestrator/src/consensus-engine.ts`
  - Add `generateCrossReviewPrompts()` (~80 lines — extract from dispatchCrossReview, remove LLM call)
  - Add `synthesizeWithCrossReview()` (~30 lines — wrapper that calls existing synthesize with provided entries)
  - Move `consensusId` generation from inside `synthesize()` to caller
  - In `crossReviewForAgent()`: use `this.config.agentLlm?.(agent.agentId) ?? this.config.llm` instead of `this.config.llm`
  - Keep `run()` unchanged for backward compat (relay-only batches)

### Dispatch pipeline
- `packages/orchestrator/src/dispatch-pipeline.ts`
  - Add `generateCrossReviewPrompts()` delegation method
  - Add `synthesizeWithCrossReview()` delegation method
  - Pass `agentLlm` factory when constructing ConsensusEngine (using cached API keys)

### MCP handlers
- `apps/cli/src/handlers/collect.ts`
  - Branch on native agents in batch: if native present, return prompts instead of full consensus
  - Store pending consensus state

- `apps/cli/src/mcp-server-sdk.ts`
  - Register `gossip_relay_cross_review` tool
  - Build `agentLlm` factory from cached API keys at boot

### State management
- `apps/cli/src/mcp-context.ts`
  - Add `pendingConsensusRounds` map
  - Add persistence/restoration for pending rounds (survive /mcp reconnect)

### MainAgent
- `packages/orchestrator/src/main-agent.ts`
  - Add delegation methods for new consensus engine methods

## Edge Cases (from sonnet-reviewer validation)

1. **Partial completion:** If orchestrator never calls gossip_relay_cross_review, relay results are lost. Mitigation: timeout watcher auto-synthesizes with available entries after deadline.
2. **ConsensusId stability:** Must be generated in Call 1 and passed to Call 2. Currently generated inside synthesize() — needs extraction.
3. **Re-entrant gossip_collect:** Second collect while consensus pending must not corrupt state. Use separate pendingConsensusRounds map.
4. **Timeout:** Spawn timeout watcher on pending round. On expiry: synthesize with relay entries + whatever native entries arrived. Record timeout signals for missing agents.
5. **synthesize() called once:** Accumulate ALL cross-review entries before single synthesize() call. Never call twice.
6. **Persist to disk:** Pending rounds must survive /mcp reconnect.
7. **Late relay:** If native cross-review arrives after timeout-triggered synthesis, log and discard.

## Non-Goals

- Changing how Phase 1 (initial review) works — already correct
- Making relay agents use Agent() — they have their own LLM providers
- Adding API keys for native agents — they run free via Agent() tool

## Validation

Design validated by:
- **sonnet-reviewer:** Confirmed two-phase split is correct, identified 7 edge cases, recommended asymmetric design (relay inline, native deferred)
- **haiku-researcher:** Confirmed feasibility, mapped all split points with line numbers, estimated ~420 lines additive, identified reusable nativeTaskMap pattern
