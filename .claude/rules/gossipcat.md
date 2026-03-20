# Gossipcat — Multi-Agent Dispatch Rules

This project uses gossipcat for multi-agent orchestration via MCP.

## Dispatch Rules

### READ tasks (review, research, analysis) — no file changes needed:

**Non-Claude agents** — gossipcat MCP tools:
```
gossip_dispatch(agent_id: "gemini-reviewer", task: "Review packages/relay/src/server.ts for security issues")
gossip_dispatch_parallel(tasks: [{agent_id: "gemini-reviewer", task: "..."}, {agent_id: "gemini-tester", task: "..."}])
gossip_collect(task_ids: ["abc123"])
```

**Claude agents** — Claude Code Agent tool (free):
```
Agent(model: "sonnet", prompt: "Review this file for bugs...", run_in_background: true)
```

### WRITE tasks (implementation, bug fixes, refactoring) — file changes needed:

**Non-Claude agents** — gossipcat MCP tools (workers have full Tool Server access):
```
gossip_dispatch(agent_id: "gemini-implementer", task: "Fix the timer leak in worker-agent.ts")
```

**Claude agents** — use `isolation: "worktree"` for full write access:
```
Agent(
  model: "sonnet",
  prompt: "Fix the timer leak in packages/orchestrator/src/worker-agent.ts. Read the file, apply the fix, run tests.",
  isolation: "worktree"
)
```
The worktree gives the agent its own branch with unrestricted file access.
After completion, review the changes and merge if approved.

### Parallel multi-provider — combine in one message:
```
gossip_dispatch(agent_id: "gemini-reviewer", task: "Security review of X")
Agent(model: "sonnet", prompt: "Performance review of X", isolation: "worktree", run_in_background: true)
```

## Available agents
Run `gossip_agents()` to see current team. Edit `gossip.agents.json` to add agents (hot-reloads, no restart).

## Skills
Auto-injected from agent config. Project skills in `.gossip/skills/`. Default skills in `packages/orchestrator/src/default-skills/`.
