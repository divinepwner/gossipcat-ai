# Cognitive Orchestration — Design Spec

> Free-text intent detection + tool-calling for the MainAgent, so natural language in the interactive chat (and `gossip_orchestrate`) automatically maps to pipeline actions without slash commands.

## Problem

Today, the interactive chat has two modes:
1. **Slash commands** (`/dispatch`, `/collect-consensus`, etc.) — powerful but require users to know the exact syntax
2. **Free-text** → `handleMessage()` → always runs task decomposition → dispatch → synthesize

This means:
- "security review the relay package with all agents" goes through decomposition, which may or may not use consensus
- "add a new agent called gemini-debugger" gets decomposed as a task and dispatched to an agent, instead of modifying config
- "what did the reviewer find last time?" gets dispatched as a research task, instead of reading local task history
- "re-run the failed tasks" has no path at all

The orchestrator needs to understand **what the user wants to happen** and route to the right pipeline method — or just chat directly when no action is needed.

## Design

### Architecture

```
user message
    │
    ▼
MainAgent.handleMessage()
    │
    ▼
LLM call with tool definitions (temperature 0)
    │
    ├─ tool_call → execute tool → auto-chain if pattern matches → return result
    │
    └─ text response → return as ChatResponse (pure chat, no action needed)
```

The MainAgent's system prompt includes tool definitions describing available orchestration actions. The LLM decides whether to call a tool or just respond with text. This is standard tool-calling — the same pattern as MCP, Claude Code, and our own agents.

### Tool Definitions

Tools the MainAgent LLM can call. Each maps to existing pipeline/system methods:

| Tool | Maps To | Auto-Chain |
|------|---------|------------|
| `dispatch` | `pipeline.dispatch()` | → `pipeline.collect()` → return result |
| `dispatch_parallel` | `pipeline.dispatchParallel()` | → `pipeline.collect()` → synthesize |
| `dispatch_consensus` | `pipeline.dispatchParallel({consensus})` | → `pipeline.collect({consensus})` → return report |
| `plan` | `dispatcher.decompose()` + `classifyWriteModes()` | → present plan as `[CHOICES]` for approval |
| `agents` | `registry.getAll()` | — |
| `agent_status` | read task history from `.gossip/agents/` | — |
| `agent_performance` | read `.gossip/agent-performance.jsonl` | — |
| `update_instructions` | write to agent instruction files | — |
| `read_task_history` | read `.gossip/agents/<id>/memory/tasks.jsonl` | — |
| `chat` | direct LLM response (no agents) | — |

The LLM chooses `chat` (or returns plain text) for questions, explanations, and anything that doesn't need orchestration.

### Auto-Chain Patterns

When the LLM calls a dispatch tool, the orchestrator automatically chains the full execution pattern. The LLM expresses intent; the orchestrator handles mechanics.

**`dispatch` pattern:**
```
LLM calls: dispatch(agent_id, task)
Orchestrator: dispatch → collect([taskId], 120s) → return result text
```

**`dispatch_parallel` pattern:**
```
LLM calls: dispatch_parallel([{agent_id, task}, ...])
Orchestrator: dispatchParallel → collect(taskIds, 120s) → synthesize → return
```

**`dispatch_consensus` pattern:**
```
LLM calls: dispatch_consensus(task, agent_ids?)
Orchestrator: dispatchParallel(all_or_specified_agents, {consensus: true})
            → collect(taskIds, 300s, {consensus: true})
            → return agent results + consensus report
```

**`plan` pattern:**
```
LLM calls: plan(task)
Orchestrator: decompose → assignAgents → classifyWriteModes
            → return plan as ChatResponse with [CHOICES] for user approval
            → on approval: execute the plan via dispatch chain
```

### Smart Dispatch Enrichment

When the orchestrator dispatches tasks, it should automatically enrich agent prompts based on task content. This is not an LLM tool — it's logic in the dispatch pipeline that detects task patterns and injects additional context.

**Spec/design review enrichment:**

When a task references a spec or design document (detected by file path patterns like `docs/`, `specs/`, `*-design.md`, `*-spec.md`), the orchestrator:

1. Reads the referenced document
2. Extracts file references from it (patterns like `packages/orchestrator/src/main-agent.ts`, `file:line` citations, file paths in tables)
3. Injects a cross-reference instruction into each agent's prompt:

```
IMPORTANT: This task references a spec document. You MUST cross-reference the spec's
claims against the actual implementation files listed below. Verify that:
- Described code flows match what the code actually does
- Backwards-compatibility claims are true
- Referenced functions/methods exist and work as described
- File paths and line numbers are accurate

Implementation files referenced by the spec:
- packages/orchestrator/src/main-agent.ts
- packages/orchestrator/src/dispatch-pipeline.ts
- ...
```

This prevents the gap where agents review a spec in isolation without checking if its claims about the codebase are actually true.

**Implementation:** Lives in `prompt-assembler.ts` as a new enrichment step. The `assemblePrompt()` function already handles memory, lens, skills, and consensus instructions. This adds a `specReview` enrichment that:
- Pattern-matches the task text for doc/spec file references
- Reads the referenced doc
- Extracts `file:line` patterns and file paths from tables/code blocks
- Appends the cross-reference instruction block

**Other enrichment opportunities (future):**
- **Code review tasks**: auto-inject `git diff` output for the referenced files
- **Bug investigation tasks**: auto-inject recent error logs or test output
- **Architecture review tasks**: auto-inject dependency graph context

### Tool Call Format

The LLM returns a JSON block in its response when it wants to call a tool:

```json
[TOOL_CALL]
{"tool": "dispatch_consensus", "args": {"task": "security review packages/relay/src"}}
[/TOOL_CALL]
```

This mirrors the existing `[CHOICES]` block parsing in `parseResponse()`. The orchestrator:
1. Detects `[TOOL_CALL]` in the LLM response
2. Parses the JSON
3. Validates tool name and args
4. Executes the tool with auto-chaining
5. Returns the result as `ChatResponse`

If the LLM returns text without `[TOOL_CALL]`, it's a plain chat response (no action).

### System Prompt

Added to `MainAgent`'s system prompt (alongside existing `CHAT_SYSTEM_PROMPT` and `bootstrapPrompt`):

```
You have access to orchestration tools. When the user's message requires an action
(dispatching agents, reviewing code, checking status, modifying config), call the
appropriate tool. When the message is a question or conversation, just respond directly.

Available tools:

dispatch(agent_id: string, task: string)
  Send a task to one specific agent. Use when the user names a specific agent or
  the task only needs one.

dispatch_parallel(tasks: [{agent_id: string, task: string}])
  Send tasks to multiple agents simultaneously. Use when the task benefits from
  multiple perspectives but doesn't need cross-review.

dispatch_consensus(task: string, agent_ids?: string[])
  Dispatch to all agents (or specified ones) with consensus cross-review.
  Use when the user wants thorough review, security audit, or says
  "review with all agents", "consensus", "cross-review", etc.

plan(task: string)
  Decompose a task into sub-tasks with write-mode classification.
  Use when the user wants to plan before executing, or the task involves
  file modifications that need approval.

agents()
  List configured agents with their skills and status.

agent_status(agent_id: string)
  Show recent task history and performance for an agent.

agent_performance()
  Show consensus signals and performance trends from agent-performance.jsonl.

update_instructions(agent_ids: string[], instruction: string, mode: "append" | "replace")
  Update agent instructions at runtime.

read_task_history(agent_id: string, limit?: number)
  Read recent task entries from an agent's memory.

To call a tool, include a [TOOL_CALL] block:
[TOOL_CALL]
{"tool": "tool_name", "args": {...}}
[/TOOL_CALL]

If the user's message is just a question or conversation, respond normally without
a tool call. You can include text before or after a [TOOL_CALL] block to explain
what you're doing.

Your team: {agent_list_from_bootstrap}
```

### Intent Examples

| User says | LLM does |
|-----------|----------|
| "security review the consensus engine" | `dispatch_consensus(task: "security review packages/orchestrator/src/consensus-engine.ts")` |
| "ask the reviewer to check the relay" | `dispatch(agent_id: "gemini-reviewer", task: "review packages/relay/src")` |
| "review relay with reviewer and tester" | `dispatch_parallel([{gemini-reviewer, ...}, {gemini-tester, ...}])` |
| "what does the consensus engine do?" | plain text response (no tool call) |
| "how are my agents performing?" | `agent_performance()` |
| "what did the reviewer find last time?" | `read_task_history(agent_id: "gemini-reviewer", limit: 1)` |
| "add debugging skills to the tester" | `update_instructions(["gemini-tester"], "You also have debugging expertise", "append")` |
| "plan a refactor of the relay package" | `plan(task: "refactor packages/relay/src")` |
| "list agents" | `agents()` |
| "re-dispatch the last review" | `dispatch_consensus(task: <last task from context>)` |

### Changes to handleMessage()

Current flow:
```typescript
async handleMessage(userMessage): Promise<ChatResponse> {
  const plan = await this.dispatcher.decompose(text);
  this.dispatcher.assignAgents(plan);
  // ... dispatch and synthesize
}
```

New flow:
```typescript
async handleMessage(userMessage): Promise<ChatResponse> {
  // 1. Call LLM with tool definitions in system prompt
  const response = await this.llm.generate([
    { role: 'system', content: this.buildSystemPrompt() },
    { role: 'user', content: userMessage },
  ], { temperature: 0 });

  // 2. Parse for tool call
  const toolCall = this.parseToolCall(response.text);

  // 3a. No tool call → pure chat response
  if (!toolCall) {
    return this.parseResponse(response.text);
  }

  // 3b. Tool call → execute with auto-chain
  const result = await this.executeToolCall(toolCall);

  // 4. Combine LLM's text (explanation) with tool result
  const explanation = response.text.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/, '').trim();
  return {
    text: explanation ? `${explanation}\n\n${result.text}` : result.text,
    status: 'done',
    agents: result.agents,
    choices: result.choices,
  };
}
```

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/tool-router.ts` | **Create** | Parse `[TOOL_CALL]` blocks, validate, execute tools with auto-chaining |
| `packages/orchestrator/src/tool-definitions.ts` | **Create** | Tool schemas, descriptions, system prompt builder |
| `packages/orchestrator/src/main-agent.ts` | **Modify** | Replace decompose-first flow with LLM-with-tools flow, add conversation history, `pendingPlan` state |
| `packages/orchestrator/src/prompt-assembler.ts` | **Modify** | Add spec-review enrichment: detect spec file refs, extract implementation file paths, inject cross-reference instructions |
| `packages/orchestrator/src/types.ts` | **Modify** | Add `ToolCall`, `ToolResult`, `HandleMessageOptions` types |
| `tests/orchestrator/tool-router.test.ts` | **Create** | Unit tests for parsing, validation, auto-chain logic |
| `tests/orchestrator/cognitive-orchestration.test.ts` | **Create** | Integration tests with mock LLM |
| `tests/orchestrator/spec-review-enrichment.test.ts` | **Create** | Tests for file reference extraction and cross-reference injection |

### What Doesn't Change

- **Slash commands in chat.ts** — still work as direct overrides. `/dispatch-consensus` bypasses intent detection entirely.
- **MCP tools** — unchanged. They call pipeline methods directly.
- **TaskDispatcher.decompose()** — still used, but now called by the `dispatch_parallel` tool handler instead of by `handleMessage()` directly.
- **Pipeline methods** — no changes to dispatch, collect, consensus engine.
- **Worker agents** — no changes.

### Edge Cases

**Ambiguous intent:** The LLM system prompt instructs it to use `[CHOICES]` when uncertain:
```
If you're unsure whether the user wants a quick answer or a full agent dispatch,
present options using the [CHOICES] format.
```

**Tool call fails:** Catch errors in `executeToolCall()`, return error as `ChatResponse` text. Don't crash the chat loop.

**LLM hallucinates a tool:** `parseToolCall()` validates against the known tool list. Unknown tools are ignored and the text portion is returned as a regular chat response.

**Long-running dispatches:** Auto-chain dispatch→collect may take minutes. The CLI already shows `thinking...` and the MCP tools already handle timeouts. No change needed.

### Migration

This is **backwards compatible**. The new `handleMessage()` is a superset of the old one:
- If the LLM returns a `dispatch_parallel` tool call, the result is identical to what the old decompose→dispatch flow produced
- If the LLM returns plain text, it's identical to the old "all unassigned" fallback
- Slash commands are unaffected

The main behavioral change: simple questions like "what does X do?" will no longer trigger unnecessary decomposition + "no agent matched" fallback. They'll get a direct LLM response.

## Review Findings & Resolutions

Spec reviewed by 4-agent Gemini consensus + Claude architect subagent. All findings addressed below.

### Resolved: Decomposition contradiction
The `dispatch_parallel` tool does NOT call `decompose()`. The LLM provides pre-decomposed tasks in its tool call args. `decompose()` is only called by the `plan` tool. The "What Doesn't Change" section is corrected.

### Resolved: Remove `chat` tool
The `chat` tool is removed from the tool definitions table. Plain text response (no `[TOOL_CALL]` block) = direct chat. No need for an explicit tool.

### Resolved: `gossip_orchestrate` becomes non-deterministic
**Problem:** `gossip_orchestrate` MCP tool calls `handleMessage()` directly. After this change, the same task goes through intent detection, which may classify differently than the old decompose flow. MCP callers expect deterministic behavior.

**Resolution:** Add a `mode` parameter to `handleMessage()`:
- `mode: 'cognitive'` (default for CLI chat) — uses intent detection + tool calling
- `mode: 'decompose'` (used by `gossip_orchestrate`) — preserves current decompose→dispatch flow

This way `gossip_orchestrate` behavior is unchanged. The CLI chat gets the new cognitive flow.

### Resolved: No conversation history
**Problem:** Intent LLM starts cold every `handleMessage()` call. "Re-dispatch the last review" can't work because there's no context.

**Resolution:** `MainAgent` maintains a sliding window of recent turns (last 10 messages + responses) in memory. The intent LLM receives this history in addition to the system prompt. The window is ephemeral (per CLI session, not persisted). This also enables the LLM to reference prior dispatch results.

```typescript
private conversationHistory: LLMMessage[] = [];
// After each handleMessage, push user + assistant messages
// Trim to last 10 pairs
```

### Resolved: Double LLM cost
**Problem:** Every message now requires an intent-detection LLM call before any pipeline action, even for tasks that would have been dispatched directly.

**Resolution:** Accept this cost — it's one cheap LLM call (short system prompt + user message, temperature 0). The benefit is that simple questions no longer trigger expensive decomposition + agent dispatch. Net cost is lower for chat-heavy sessions and roughly equal for dispatch-heavy sessions. The intent call replaces the decompose call, it doesn't add on top.

### Resolved: `plan` approval→execution path
**Problem:** The `plan` tool returns `[CHOICES]` for approval, but `handleChoice` has no way to execute the stored plan.

**Resolution:** The `plan` tool stores the decomposed plan in `MainAgent.pendingPlan`. When `handleChoice` receives approval, it checks `pendingPlan` and dispatches via the pipeline:

```typescript
private pendingPlan: { plan: DispatchPlan; tasks: PlannedTask[] } | null = null;

async handleChoice(originalMessage: string, choiceValue: string): Promise<ChatResponse> {
  if (this.pendingPlan && choiceValue === 'execute') {
    const result = await this.executePlan(this.pendingPlan);
    this.pendingPlan = null;
    return result;
  }
  // ... existing follow-up flow
}
```

### Resolved: `update_instructions` safety
**Problem:** (a) LLM can modify agent prompts without confirmation. (b) `replace` mode can destroy hand-written instructions. (c) Writing to disk doesn't hot-reload running workers.

**Resolution:**
- `update_instructions` always returns a `[CHOICES]` confirmation before applying. The LLM proposes the change; the user approves.
- `replace` mode is removed. Only `append` is supported via the intent layer. Direct `replace` requires the MCP tool or slash command.
- After writing, the tool handler calls `worker.updateInstructions(newContent)` to hot-reload. If hot-reload isn't supported yet, document this as a known limitation (restart required).
- Agent ID is validated against registry before any file I/O.

### Resolved: `[CHOICES]` + `[TOOL_CALL]` interaction
**Problem:** If LLM emits both blocks in one response, parse order is undefined.

**Resolution:** `[TOOL_CALL]` takes precedence. If a `[TOOL_CALL]` block is detected, `parseResponse()` is NOT called on the same text. Tool calls and choices are mutually exclusive in a single response. If the tool execution itself needs to present choices (like `plan`), the tool handler returns a `ChatResponse` with `choices` set.

### Resolved: Image inputs dropped
**Problem:** `ContentBlock[]` with images gets passed to the intent LLM, but the tool-call dispatch path loses the image.

**Resolution:** When `handleMessage` receives `ContentBlock[]`, the full content is passed to the intent LLM (which supports multimodal). If the LLM returns a tool call (e.g., `dispatch`), the original `ContentBlock[]` is forwarded as part of the task description. The `dispatch` tool handler serializes image blocks as base64 references in the task text. For non-dispatch tools (like `agents`, `status`), images are irrelevant and safely ignored.

### Resolved: Multiple `[TOOL_CALL]` blocks
**Resolution:** `parseToolCall()` extracts only the FIRST `[TOOL_CALL]` block. All `[TOOL_CALL]...[/TOOL_CALL]` blocks are stripped from the explanation text before returning to the user. A warning is logged to stderr if multiple blocks are detected.

### Resolved: Path traversal in `agent_id` params
**Resolution:** All tool handlers that accept `agent_id` validate it against the registry first (`registry.get(agentId)`). If the agent doesn't exist, return an error. The `agent_id` is never used to construct file paths directly — always looked up through the registry which has pre-validated IDs matching `/^[a-zA-Z0-9_-]+$/`.

### Resolved: Duplicate agent list in system prompt
**Resolution:** The tool definitions system prompt does NOT include the agent list. It references: "See the team context above for available agents." The bootstrap prompt (which already includes the agent list) is prepended separately, avoiding duplication.

### Resolved: Robust `[TOOL_CALL]` parser
**Resolution:** `parseToolCall()` implementation requirements:
- Strip markdown code fences inside the block
- Handle trailing commas in JSON
- Handle single quotes (convert to double)
- Validate tool name against known tool list
- Validate required args per tool schema
- Clamp/default optional args
- Return `null` (not throw) on any parse failure — graceful degradation to chat response
- Log parse failures to stderr for debugging

### Resolved: Infinite loop protection
**Resolution:** Tool execution results are NEVER re-processed through intent detection. The `executeToolCall()` method returns a `ToolResult` that is directly converted to `ChatResponse`. The code path is:
```
handleMessage → LLM call → parseToolCall → executeToolCall → return ChatResponse
```
There is no recursive call back to `handleMessage` from within `executeToolCall`.

### Resolved: Path traversal in Smart Dispatch Enrichment (Round 2)
**Problem:** The enrichment feature reads a spec file path from the user's task text. A malicious path like `../../../../etc/passwd` could leak sensitive files.

**Resolution:** All file paths extracted from task text are validated before reading:
1. Resolve to absolute path and check it's within `projectRoot`
2. Use the project's existing `Sandbox.validatePath()` from `@gossip/tools` if available
3. Reject paths containing `..` segments
4. Only read files with known doc extensions (`.md`, `.txt`, `.rst`)

### Resolved: `pendingPlan` race condition (Round 2)
**Problem:** If a user requests a second plan before approving the first, `pendingPlan` is silently overwritten. The user might then approve thinking they're executing plan A, but plan B runs instead.

**Resolution:** If `pendingPlan` is already set when the `plan` tool is called again, return a `[CHOICES]` prompt:
```
You have a pending plan that hasn't been executed yet.
- discard_and_replan | Discard the old plan and create a new one
- execute_pending | Execute the pending plan first
- cancel | Cancel
```
Only one plan can be pending at a time.

### Resolved: Fragile `'execute'` choice value (Round 2)
**Problem:** The `pendingPlan` flow relies on `choiceValue === 'execute'`, which is a fragile string contract between the LLM's `[CHOICES]` output and `handleChoice`.

**Resolution:** The `plan` tool handler constructs the `[CHOICES]` block deterministically (not LLM-generated). The choice values are constants defined in `tool-definitions.ts`:
```typescript
export const PLAN_CHOICES = {
  EXECUTE: 'plan_execute',
  MODIFY: 'plan_modify',
  CANCEL: 'plan_cancel',
} as const;
```
`handleChoice` checks against these constants, not arbitrary strings.

### Deferred: Environmental context awareness
Context about current file, git status, etc. is valuable but orthogonal to this feature. Deferred to a follow-up spec. The conversation history window partially addresses this — the LLM can see what files were recently discussed.

### Deferred: Multi-step execution
Research-then-act patterns (e.g., "check git diff then review changed files") require a stateful execution context beyond single-turn. Deferred to v2. For now, the user chains steps manually via conversation or slash commands.

## Decisions

1. **Tool calling via `[TOOL_CALL]` blocks** — not native function calling, because the MainAgent LLM may be any provider (Google, Anthropic, OpenAI) and we don't want provider-specific tool-calling APIs. Text-based tool calls work universally.
2. **Auto-chaining** — the LLM expresses intent, the orchestrator handles the full execution pattern. The LLM doesn't manage task IDs or polling.
3. **Single-turn** — one tool call per `handleMessage()`. Multi-step workflows use the existing `[CHOICES]` mechanism for user confirmation between steps.
4. **Tools live in orchestrator** — both CLI chat and MCP `gossip_orchestrate` benefit. Not a CLI-only feature.
5. **`handleMessage` has two modes** — `cognitive` (intent detection, default for chat) and `decompose` (old flow, used by `gossip_orchestrate` MCP tool).
6. **Conversation history** — sliding window of last 10 turns, ephemeral per session.
7. **`[TOOL_CALL]` takes precedence** over `[CHOICES]` when both appear. Mutually exclusive parse paths.
8. **All `agent_id` params validated** against registry before any I/O.
9. **Spec file paths sandboxed** — Smart Dispatch Enrichment validates all paths within `projectRoot` before reading.
10. **One pending plan at a time** — requesting a new plan while one is pending requires explicit user choice.
11. **Plan choice values are constants** — not LLM-generated strings.
