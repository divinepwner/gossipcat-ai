import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolServer } from '../../packages/tools/src/tool-server';

// We need to test the enforcement without a live relay.
// ToolServer.executeTool is public, so we can call it directly.
// But ToolServer constructor requires a relay connection.
// Instead, test the enforcement logic by creating the server
// and calling assignScope/assignRoot + executeTool directly.

// Mock GossipAgent to avoid actual relay connection
vi.mock('@gossip/client', () => ({
  GossipAgent: class {
    agentId = 'tool-server';
    async connect() {}
    async disconnect() {}
    on() {}
    async sendEnvelope() {}
  },
}));

describe('ToolServer scope enforcement', () => {
  let server: ToolServer;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gossip-test-'));
    server = new ToolServer({
      relayUrl: 'ws://localhost:0',
      projectRoot,
    });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('scoped agents', () => {
    beforeEach(() => {
      server.assignScope('agent-1', 'packages/relay/');
    });

    it('blocks file_write outside scope', async () => {
      await expect(
        server.executeTool('file_write', { path: 'packages/tools/foo.ts', content: 'x' }, 'agent-1')
      ).rejects.toThrow(/outside scope/);
    });

    it('allows file_write within scope', async () => {
      // This will fail at the file level (no actual file), but NOT at the scope level
      // So we just verify it doesn't throw a scope error
      try {
        await server.executeTool('file_write', { path: 'packages/relay/foo.ts', content: 'x' }, 'agent-1');
      } catch (err) {
        expect((err as Error).message).not.toContain('outside scope');
      }
    });

    it('blocks shell_exec for scoped agents', async () => {
      await expect(
        server.executeTool('shell_exec', { command: 'ls' }, 'agent-1')
      ).rejects.toThrow(/shell_exec is restricted in scoped write mode/);
    });

    it('blocks git_commit for scoped agents', async () => {
      await expect(
        server.executeTool('git_commit', { message: 'test' }, 'agent-1')
      ).rejects.toThrow(/Git commit blocked/);
    });

    it('blocks file_read outside scope', async () => {
      await expect(
        server.executeTool('file_read', { path: 'packages/tools/bar.ts' }, 'agent-1')
      ).rejects.toThrow(/outside scope/);
    });

    it('blocks file_write to sibling prefix without trailing slash', async () => {
      // Test that scope 'packages/relay/' doesn't allow 'packages/relay2/evil.ts'
      // (This should work since assignScope normalizes trailing slash)
      await expect(
        server.executeTool('file_write', { path: 'packages/relay2/evil.ts', content: 'x' }, 'agent-1')
      ).rejects.toThrow(/outside scope/);
    });

    it('blocks git_branch for scoped agents', async () => {
      await expect(
        server.executeTool('git_branch', { name: 'evil-branch' }, 'agent-1')
      ).rejects.toThrow(/Git branch blocked/);
    });

    it('blocks file_write using path traversal to escape scope', async () => {
      await expect(
        server.executeTool('file_write', { path: 'packages/relay/../tools/evil.ts', content: 'x' }, 'agent-1')
      ).rejects.toThrow(/outside scope/);
    });
  });

  describe('worktree agents', () => {
    beforeEach(() => {
      server.assignRoot('agent-2', '/tmp/gossip-wt-abc/');
    });

    it('blocks file_write outside worktree root', async () => {
      await expect(
        server.executeTool('file_write', { path: '/other/path/foo.ts', content: 'x' }, 'agent-2')
      ).rejects.toThrow(/outside worktree root/);
    });

    it('allows shell_exec for worktree agents', async () => {
      // shell_exec may fail but should NOT throw a scope error
      try {
        await server.executeTool('shell_exec', { command: 'ls' }, 'agent-2');
      } catch (err) {
        expect((err as Error).message).not.toContain('blocked');
      }
    });

    it('blocks shell commands with path traversal', async () => {
      await expect(
        server.executeTool('shell_exec', { command: 'cat ../../etc/passwd' }, 'agent-2')
      ).rejects.toThrow(/Shell command blocked/);
    });

    it.each([
      ['git config core.hooksPath /tmp/evil'],
      ['rm -rf ./.git/hooks/pre-commit'],
      ['echo "evil" > .git/config'],
    ])('blocks shell command manipulating git internals: %s', async (command) => {
      await expect(
        server.executeTool('shell_exec', { command }, 'agent-2')
      ).rejects.toThrow(/Shell command blocked/);
    });
  });

  describe('fail-closed enforcement', () => {
    it('blocks write tools if agent is in writeAgents but has no scope/root', async () => {
      // Simulate state inconsistency: write agent with no scope
      (server as any).writeAgents.add('agent-no-scope');
      await expect(
        server.executeTool('file_write', { path: 'any/file.ts', content: 'x' }, 'agent-no-scope')
      ).rejects.toThrow(/is a write agent but has no scope\/root registered/);
    });
  });

  describe('release', () => {
    it('released agents bypass enforcement', async () => {
      server.assignScope('agent-1', 'packages/relay/');
      server.releaseAgent('agent-1');
      // After release, scope enforcement should not apply
      try {
        await server.executeTool('file_write', { path: 'packages/tools/foo.ts', content: 'x' }, 'agent-1');
      } catch (err) {
        expect((err as Error).message).not.toContain('outside scope');
      }
    });
  });
});
