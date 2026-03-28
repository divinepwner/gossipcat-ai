import { SkillIndex } from '@gossip/orchestrator';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SkillIndex', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `gossip-skill-index-test-${Date.now()}`);
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates empty index when no file exists', () => {
    const index = new SkillIndex(testDir);
    expect(index.getIndex()).toEqual({});
    expect(index.exists()).toBe(false);
  });

  describe('bind()', () => {
    it('binds a skill to an agent', () => {
      const index = new SkillIndex(testDir);
      const slot = index.bind('agent-a', 'security-audit');
      expect(slot.skill).toBe('security-audit');
      expect(slot.enabled).toBe(true);
      expect(slot.version).toBe(1);
      expect(slot.source).toBe('manual');
    });

    it('normalizes skill names', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'Security_Audit');
      expect(index.getSlot('agent-a', 'security-audit')).toBeDefined();
    });

    it('increments version on re-bind', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      const slot2 = index.bind('agent-a', 'typescript');
      expect(slot2.version).toBe(2);
    });

    it('persists to disk', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'code-review');

      const filePath = join(testDir, '.gossip', 'skill-index.json');
      expect(existsSync(filePath)).toBe(true);
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data['agent-a']['code-review']).toBeDefined();
    });

    it('reloads from disk on new instance', () => {
      const index1 = new SkillIndex(testDir);
      index1.bind('agent-a', 'typescript', { enabled: true, source: 'auto' });

      const index2 = new SkillIndex(testDir);
      const slot = index2.getSlot('agent-a', 'typescript');
      expect(slot).toBeDefined();
      expect(slot!.source).toBe('auto');
    });
  });

  describe('unbind()', () => {
    it('removes a skill slot', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      expect(index.unbind('agent-a', 'typescript')).toBe(true);
      expect(index.getSlot('agent-a', 'typescript')).toBeUndefined();
    });

    it('returns false for non-existent slot', () => {
      const index = new SkillIndex(testDir);
      expect(index.unbind('agent-a', 'nonexistent')).toBe(false);
    });

    it('removes agent entry when last skill unbound', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      index.unbind('agent-a', 'typescript');
      expect(index.getAgentIds()).not.toContain('agent-a');
    });
  });

  describe('enable() / disable()', () => {
    it('disables a skill without removing it', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'security-audit');
      expect(index.disable('agent-a', 'security-audit')).toBe(true);

      const slot = index.getSlot('agent-a', 'security-audit');
      expect(slot!.enabled).toBe(false);
    });

    it('re-enables a disabled skill', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'security-audit', { enabled: false });
      expect(index.enable('agent-a', 'security-audit')).toBe(true);
      expect(index.getSlot('agent-a', 'security-audit')!.enabled).toBe(true);
    });

    it('returns false for non-existent slot', () => {
      const index = new SkillIndex(testDir);
      expect(index.enable('agent-a', 'nope')).toBe(false);
      expect(index.disable('agent-a', 'nope')).toBe(false);
    });
  });

  describe('getEnabledSkills()', () => {
    it('returns only enabled skills', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      index.bind('agent-a', 'security-audit');
      index.bind('agent-a', 'testing', { enabled: false });

      const enabled = index.getEnabledSkills('agent-a');
      expect(enabled).toContain('typescript');
      expect(enabled).toContain('security-audit');
      expect(enabled).not.toContain('testing');
    });

    it('returns empty array for unknown agent', () => {
      const index = new SkillIndex(testDir);
      expect(index.getEnabledSkills('nobody')).toEqual([]);
    });
  });

  describe('seedFromConfigs()', () => {
    it('populates index from agent config skill arrays', () => {
      const index = new SkillIndex(testDir);
      index.seedFromConfigs([
        { id: 'sonnet-reviewer', skills: ['code_review', 'security_audit', 'typescript'] },
        { id: 'gemini-impl', skills: ['typescript', 'implementation'] },
      ]);

      expect(index.getEnabledSkills('sonnet-reviewer')).toHaveLength(3);
      expect(index.getEnabledSkills('gemini-impl')).toHaveLength(2);
      // Normalized names
      expect(index.getSlot('sonnet-reviewer', 'code-review')).toBeDefined();
      expect(index.getSlot('sonnet-reviewer', 'security-audit')).toBeDefined();
    });

    it('marks seeded slots as config source', () => {
      const index = new SkillIndex(testDir);
      index.seedFromConfigs([{ id: 'agent-a', skills: ['typescript'] }]);
      expect(index.getSlot('agent-a', 'typescript')!.source).toBe('config');
    });

    it('does not overwrite existing slots', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript', { source: 'manual' });
      index.seedFromConfigs([{ id: 'agent-a', skills: ['typescript'] }]);
      expect(index.getSlot('agent-a', 'typescript')!.source).toBe('manual');
    });
  });

  describe('getAgentSlots()', () => {
    it('returns all slots for an agent', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      index.bind('agent-a', 'testing', { enabled: false });

      const slots = index.getAgentSlots('agent-a');
      expect(slots).toHaveLength(2);
      expect(slots.find(s => s.skill === 'testing')!.enabled).toBe(false);
    });
  });

  describe('validation + security', () => {
    it('rejects empty skill name', () => {
      const index = new SkillIndex(testDir);
      expect(() => index.bind('agent-a', '!!!')).toThrow('Invalid skill name');
    });

    it('rejects __proto__ as agentId', () => {
      const index = new SkillIndex(testDir);
      expect(() => index.bind('__proto__', 'typescript')).toThrow('Invalid agentId');
    });

    it('rejects constructor as agentId', () => {
      const index = new SkillIndex(testDir);
      expect(() => index.bind('constructor', 'typescript')).toThrow('Invalid agentId');
    });

    it('rejects empty agentId', () => {
      const index = new SkillIndex(testDir);
      expect(() => index.bind('', 'typescript')).toThrow('Invalid agentId');
    });

    it('handles corrupted JSON file gracefully', () => {
      const { writeFileSync: wf } = require('fs');
      const { join: j } = require('path');
      wf(j(testDir, '.gossip', 'skill-index.json'), 'not valid json!!!');
      const index = new SkillIndex(testDir);
      expect(index.getIndex()).toEqual({});
    });

    it('handles null JSON file gracefully', () => {
      const { writeFileSync: wf } = require('fs');
      const { join: j } = require('path');
      wf(j(testDir, '.gossip', 'skill-index.json'), 'null');
      const index = new SkillIndex(testDir);
      expect(index.getIndex()).toEqual({});
    });

    it('handles array JSON file gracefully', () => {
      const { writeFileSync: wf } = require('fs');
      const { join: j } = require('path');
      wf(j(testDir, '.gossip', 'skill-index.json'), '[]');
      const index = new SkillIndex(testDir);
      expect(index.getIndex()).toEqual({});
    });

    it('seedFromConfigs skips non-string skills', () => {
      const index = new SkillIndex(testDir);
      index.seedFromConfigs([{ id: 'agent-a', skills: ['typescript', null as any, undefined as any, 42 as any] }]);
      expect(index.getEnabledSkills('agent-a')).toEqual(['typescript']);
    });
  });

  describe('immutability', () => {
    it('getIndex returns a copy that does not affect internal state', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      const data = index.getIndex();
      data['agent-a']['typescript'].enabled = false;
      // Internal state should be unchanged
      expect(index.getSlot('agent-a', 'typescript')!.enabled).toBe(true);
    });

    it('getSlot returns a copy', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      const slot = index.getSlot('agent-a', 'typescript')!;
      slot.enabled = false;
      expect(index.getSlot('agent-a', 'typescript')!.enabled).toBe(true);
    });

    it('getAgentSlots returns copies', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      const slots = index.getAgentSlots('agent-a');
      slots[0].enabled = false;
      expect(index.getSlot('agent-a', 'typescript')!.enabled).toBe(true);
    });
  });

  describe('version bumping', () => {
    it('bumps version on enable', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript', { enabled: false });
      expect(index.getSlot('agent-a', 'typescript')!.version).toBe(1);
      index.enable('agent-a', 'typescript');
      expect(index.getSlot('agent-a', 'typescript')!.version).toBe(2);
    });

    it('bumps version on disable', () => {
      const index = new SkillIndex(testDir);
      index.bind('agent-a', 'typescript');
      index.disable('agent-a', 'typescript');
      expect(index.getSlot('agent-a', 'typescript')!.version).toBe(2);
    });
  });
});
