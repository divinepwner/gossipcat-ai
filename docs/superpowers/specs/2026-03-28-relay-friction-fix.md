# Relay Friction Fix — Design Spec

> Reduce dispatch ceremony from 3 calls to 1-2 so users never skip the relay, ensuring ATI data flows consistently.

**Date:** 2026-03-28
**Status:** Ready for implementation
**Dependencies:** Gossip dispatch (shipped), Native agent bridge (shipped), ATI signal pipeline (shipped)
**Motivation:** Real user feedback — "the relay adds friction that makes me skip it for simple tasks. If the relay were invisible, I'd never leave the mesh."

---

## Problem Statement

Today's dispatch flow for a single task:

| Agent Type | Steps | Calls |
|-----------|-------|-------|
| Relay worker (Gemini) | `gossip_dispatch` → `gossip_collect` | 2 |
| Native agent (Sonnet) | `gossip_dispatch` → `Agent()` → `gossip_relay_result` | 3 |

Users skip the relay for implementation tasks because the ceremony is too much. When they skip it, ATI gets no performance signals and the self-improvement loop breaks.

## Design

### `gossip_run` — Single-Call Dispatch

One MCP tool that handles the full dispatch-collect lifecycle.

**For relay workers (Gemini):** Truly single-call — dispatches, waits for completion, returns result.

```typescript
gossip_run({ agent_id: "gemini-reviewer", task: "review X" })
// → internally: dispatch → collect → return result
// → meta signals emitted via existing onTaskComplete callback
// → one MCP tool call, one response
```

**For native agents (Sonnet/Haiku):** Returns dispatch instruction with a simplified callback.

```typescript
gossip_run({ agent_id: "sonnet-reviewer", task: "review X" })
// → response: "Call Agent(sonnet, prompt), then gossip_run_complete(task_id, result)"
// → 2 calls instead of 3
```

### `gossip_run_complete` — Native Agent Callback

Combines `gossip_relay_result` + signal emission in one call. Only needed for native agents.

```typescript
gossip_run_complete({ task_id: "abc123", result: "<agent output>" })
// → relays result to mesh
// → returns confirmation
// → 1 call instead of separate relay_result
```

### Tool Schemas

```typescript
// gossip_run
{
  name: 'gossip_run',
  description: 'Run a task on an agent and return the result. For relay agents, this is a single call. For native agents, returns dispatch instructions with a simplified callback.',
  inputSchema: {
    agent_id: z.string().describe('Agent to run the task on'),
    task: z.string().describe('Task description'),
    write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
    scope: z.string().optional(),
  }
}

// gossip_run_complete
{
  name: 'gossip_run_complete',
  description: 'Complete a native agent task dispatched via gossip_run. Relays the result to the mesh. Call this after the Agent() tool returns.',
  inputSchema: {
    task_id: z.string().describe('Task ID from gossip_run response'),
    result: z.string().describe('Agent output text'),
    error: z.string().optional().describe('Error message if agent failed'),
  }
}
```

### Implementation

Both tools are thin wrappers in `mcp-server-sdk.ts`:

```typescript
// gossip_run handler
async ({ agent_id, task, write_mode, scope }) => {
  await boot();
  const isNative = nativeAgentConfigs.has(agent_id);
  const options = { writeMode: write_mode, scope };

  if (isNative) {
    // Native agent — dispatch and return instructions
    const { taskId } = mainAgent.dispatch(agent_id, task, options);
    const config = nativeAgentConfigs.get(agent_id)!;
    const preset = mainAgent.registry?.get(agent_id)?.preset || '';
    const presetPrompt = getPresetPrompt(preset);

    return {
      content: [{ type: 'text', text:
        `Dispatched to ${agent_id} (native). Task ID: ${taskId}\n\n` +
        `NATIVE_DISPATCH:\n` +
        `Agent(model: "${config.model}", prompt: "${presetPrompt}\\n\\n---\\n\\nTask: ${task.slice(0, 200)}")\n` +
        `  → then: gossip_run_complete(task_id: "${taskId}", result: "<output>")\n`
      }],
    };
  }

  // Relay worker — dispatch and collect in one call
  const { taskId } = mainAgent.dispatch(agent_id, task, options);
  const result = await mainAgent.collect([taskId], 120000);
  const entry = result.results[0];
  const output = entry?.status === 'completed'
    ? entry.result || '[No response]'
    : `Error: ${entry?.error || 'Task failed'}`;

  return {
    content: [{ type: 'text', text:
      `[${taskId}] ${agent_id} (${((entry?.completedAt || 0) - (entry?.startedAt || 0))}ms):\n${output}`
    }],
  };
}

// gossip_run_complete handler
async ({ task_id, result, error }) => {
  await boot();

  // Use existing relay_result logic
  const entry = mainAgent.getTask?.(task_id);
  if (!entry) {
    return { content: [{ type: 'text', text: `Unknown task ID: ${task_id}` }] };
  }

  // Relay result to mesh (same as gossip_relay_result)
  await relayNativeResult(task_id, error || result);

  return {
    content: [{ type: 'text', text:
      `✅ Result relayed for ${entry.agentId} [${task_id}]`
    }],
  };
}
```

---

## Friction Comparison

| Scenario | Before | After |
|----------|--------|-------|
| Gemini single task | `dispatch` + `collect` (2 calls) | `gossip_run` (1 call) |
| Sonnet single task | `dispatch` + `Agent` + `relay_result` (3 calls) | `gossip_run` + `Agent` + `gossip_run_complete` (2 calls with clearer names) |
| Gemini parallel | `dispatch_parallel` + `collect` (2 calls) | unchanged — use existing tools |
| Any consensus review | `dispatch_parallel` + `collect(consensus)` (2 calls) | unchanged — consensus requires multiple agents |

`gossip_run` is for **single-agent, single-task** workflows. Parallel dispatch and consensus still use the existing `gossip_dispatch_parallel` + `gossip_collect`.

---

## Architecture

### Modified Files

| File | Change |
|------|--------|
| `apps/cli/src/mcp-server-sdk.ts` | Add `gossip_run` and `gossip_run_complete` tool handlers |
| `dist-mcp/mcp-server.js` | Rebuild via `npm run build:mcp` |

### No New Orchestrator Code

Both tools compose existing functionality:
- `gossip_run` calls `mainAgent.dispatch()` + `mainAgent.collect()`
- `gossip_run_complete` calls the existing `relayNativeResult()` function

---

## Testing Strategy

### gossip_run — relay worker (unit)
- Dispatches to relay worker → returns result in one call
- Handles worker timeout → returns error message
- Handles worker failure → returns error message

### gossip_run — native agent (unit)
- Returns NATIVE_DISPATCH instruction with task_id
- Includes correct model and preset prompt
- Includes gossip_run_complete callback instruction

### gossip_run_complete (unit)
- Relays result for known task_id → returns confirmation
- Unknown task_id → returns error
- Error parameter → relays error

### Integration
- gossip_run(relay) → verify meta signals written to JSONL
- gossip_run(native) → Agent → gossip_run_complete → verify result relayed

---

## Security

- Same validation as existing tools (agent_id regex, scope validation)
- gossip_run_complete validates task_id exists before relaying
- No new trust boundaries — composes existing verified functionality
