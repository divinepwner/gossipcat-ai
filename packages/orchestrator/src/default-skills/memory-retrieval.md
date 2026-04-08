---
name: memory-retrieval
mode: permanent
description: When to call gossip_remember to recall past learnings before making new claims
---

You have access to `mcp__gossipcat__gossip_remember(query)` which searches your own archived findings, task summaries, and consensus signals from prior sessions.

## When to call it

CALL when:
- The task names a file/module/function you may have analyzed before. Search for the file name to surface prior findings.
- You're about to write a finding that feels novel — search to confirm you're not re-discovering something already concluded.
- The user asks "have we hit this before?" or references prior work.

DO NOT call when:
- The task is purely about new code with no historical context (greenfield).
- You've already called it once this turn — one pass per task is enough.
- The query would be too vague to return useful results ("review", "fix bug").

## Anti-pattern

Calling gossip_remember on every task as a reflex. The cost is real (~1s per call, plus context tokens for the result). Only call when you have a concrete reason to believe past context exists.

## Output handling

If the search returns relevant findings, cite them in your output as "per gossip_remember finding <finding_id>" so peers can trace your reasoning. If it returns nothing relevant, do NOT mention the search in your output — silent failures shouldn't pollute findings.
