# CLAUDE.md

## Gossipcat — Multi-Agent Orchestration

**FIRST:** Read `.gossip/bootstrap.md` before exploring the codebase.
It contains team config, session context from the last session (what shipped, what failed, what's in progress), and dispatch rules. This saves you from re-exploring files the previous session already understood.

Also read `.gossip/next-session.md` if it exists — it has the prioritized task list.

Call `gossip_setup(mode: "merge", ...)` to refresh after adding/removing agents.
Call `gossip_session_save()` before ending your session to preserve context.

**After consensus:** Verify ALL UNVERIFIED findings against the code before presenting
results. UNVERIFIED means the cross-reviewer couldn't check — you can and must. Do not
show raw consensus results with unexamined UNVERIFIED findings.

## Agent Accuracy — Skill Development

When an agent has low accuracy or repeated hallucinations, **use the skill system, not
instruction edits.** Instructions (`.gossip/agents/<id>/instructions.md`) are the base
prompt — they set role and rules. Skills (`.gossip/agents/<id>/skills/*.md`) are
specialized knowledge injected per-dispatch based on the agent's actual failure patterns.

**How to improve a struggling agent:**
1. Check `gossip_scores()` to identify low-accuracy agents
2. Call `gossip_skills(action: "develop", agent_id: "<id>", category: "<category>")`
   - This generates an agent-specific skill file from their failure data
   - Categories: `trust_boundaries`, `injection_vectors`, `input_validation`,
     `concurrency`, `resource_exhaustion`, `type_safety`, `error_handling`, `data_integrity`
3. Bind if not auto-bound: `gossip_skills(action: "bind", agent_id: "<id>", skill: "<name>")`
4. Verify with `gossip_skills(action: "list")` — skill should show as enabled

**Skill resolution order:** agent-local → project-wide → bundled defaults.
Agent-local skills (from `develop`) override defaults with targeted improvements.

**Do NOT:** Edit `instructions.md` to fix accuracy. Instructions set the base contract.
Skills are the mechanism for targeted, evidence-based improvement.

---

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available skills

- `/office-hours` — YC-style brainstorming and idea validation
- `/plan-ceo-review` — CEO/founder-mode plan review
- `/plan-eng-review` — Engineering manager plan review
- `/plan-design-review` — Designer's eye plan review
- `/design-consultation` — Design system and brand guidelines
- `/review` — Pre-landing PR review
- `/ship` — Ship workflow (test, review, commit, push, PR)
- `/browse` — Headless browser for QA and dogfooding
- `/qa` — QA test and fix bugs
- `/qa-only` — QA report only (no fixes)
- `/design-review` — Visual design audit and fix
- `/setup-browser-cookies` — Import browser cookies for authenticated testing
- `/retro` — Weekly engineering retrospective
- `/investigate` — Systematic root cause debugging
- `/document-release` — Post-ship documentation update
- `/codex` — Second opinion via OpenAI Codex CLI
- `/careful` — Safety guardrails for destructive commands
- `/freeze` — Restrict edits to a specific directory
- `/guard` — Full safety mode (careful + freeze)
- `/unfreeze` — Remove freeze boundary
- `/gstack-upgrade` — Upgrade gstack to latest version
