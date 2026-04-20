import {
  buildProjectXrefIndex,
  clearProjectXrefCache,
  projectXrefCacheSize,
  ConsensusEngine,
  IGNORE_DIRS,
} from '@gossip/orchestrator';
import type { ILLMProvider } from '@gossip/orchestrator';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeDummyLlm(): ILLMProvider {
  return { generate: async () => ({ text: '' }) };
}

describe('buildProjectXrefIndex', () => {
  let dir: string;
  beforeEach(() => {
    clearProjectXrefCache();
    dir = mkdtempSync(join(tmpdir(), 'xref-proj-'));
  });
  afterEach(() => {
    clearProjectXrefCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('walks a mixed-language tree and builds a unified index', () => {
    writeFileSync(join(dir, 'a.ts'), 'export function alpha() { helper(); }\nfunction helper() {}');
    writeFileSync(join(dir, 'b.py'), 'def beta():\n    gamma()\ndef gamma():\n    pass\n');
    writeFileSync(join(dir, 'c.go'), 'package x\nfunc Delta() { Epsilon() }\nfunc Epsilon() {}\n');
    writeFileSync(join(dir, 'd.rs'), 'fn zeta() { eta(); }\nfn eta() {}\n');

    const r = buildProjectXrefIndex(dir);

    expect(r.fileCount).toBe(4);
    expect(r.errorCount).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.index.callersOf('helper')).toHaveLength(1);
    expect(r.index.callersOf('gamma')).toHaveLength(1);
    expect(r.index.callersOf('Epsilon')).toHaveLength(1);
    expect(r.index.callersOf('eta')).toHaveLength(1);
  });

  it('skips directories in IGNORE_DIRS', () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'x.ts'), 'function inModule() {}');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'bundle.js'), 'function inDist() {}');
    writeFileSync(join(dir, 'real.ts'), 'function inRepo() {}');

    const r = buildProjectXrefIndex(dir);
    expect(r.index.definedAt('inModule')).toHaveLength(0);
    expect(r.index.definedAt('inDist')).toHaveLength(0);
    expect(r.index.definedAt('inRepo')).toHaveLength(1);
  });

  it('ignores dotfiles except allow-listed ones', () => {
    mkdirSync(join(dir, '.hidden'), { recursive: true });
    writeFileSync(join(dir, '.hidden', 'x.ts'), 'function hidden() {}');
    writeFileSync(join(dir, 'visible.ts'), 'function visible() {}');

    const r = buildProjectXrefIndex(dir);
    expect(r.index.definedAt('hidden')).toHaveLength(0);
    expect(r.index.definedAt('visible')).toHaveLength(1);
  });

  it('returns the cached result on second call (no re-walk)', () => {
    writeFileSync(join(dir, 'a.ts'), 'function a() {}');
    const first = buildProjectXrefIndex(dir);
    writeFileSync(join(dir, 'b.ts'), 'function b() {}');
    const second = buildProjectXrefIndex(dir);

    // Cache hit: `b` from the second write is NOT indexed.
    expect(second.fileCount).toBe(first.fileCount);
    expect(second.index.definedAt('b')).toHaveLength(0);
  });

  it('re-walks when force: true is passed', () => {
    writeFileSync(join(dir, 'a.ts'), 'function a() {}');
    buildProjectXrefIndex(dir);
    writeFileSync(join(dir, 'b.ts'), 'function b() {}');
    const forced = buildProjectXrefIndex(dir, { force: true });
    expect(forced.index.definedAt('b')).toHaveLength(1);
  });

  it('IGNORE_DIRS includes the common large/build directories', () => {
    for (const expected of ['node_modules', 'dist', '.git', '.gossip', 'target']) {
      expect(IGNORE_DIRS.has(expected)).toBe(true);
    }
  });

  it('clearProjectXrefCache empties the cache', () => {
    writeFileSync(join(dir, 'a.ts'), 'function a() {}');
    buildProjectXrefIndex(dir);
    expect(projectXrefCacheSize()).toBeGreaterThan(0);
    clearProjectXrefCache();
    expect(projectXrefCacheSize()).toBe(0);
  });

  it('clearProjectXrefCache(root) drops only that entry', () => {
    const other = mkdtempSync(join(tmpdir(), 'xref-other-'));
    try {
      writeFileSync(join(dir, 'a.ts'), 'function a() {}');
      writeFileSync(join(other, 'b.ts'), 'function b() {}');
      buildProjectXrefIndex(dir);
      buildProjectXrefIndex(other);
      expect(projectXrefCacheSize()).toBe(2);
      clearProjectXrefCache(dir);
      expect(projectXrefCacheSize()).toBe(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('ConsensusEngine — xref auto-wiring', () => {
  let dir: string;
  const llm = makeDummyLlm();
  const registryGet = () => undefined;

  beforeEach(() => {
    clearProjectXrefCache();
    dir = mkdtempSync(join(tmpdir(), 'xref-wire-'));
    delete process.env.GOSSIP_DISABLE_XREF;
  });
  afterEach(() => {
    clearProjectXrefCache();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GOSSIP_DISABLE_XREF;
  });

  it('auto-builds an xref index when projectRoot is set', () => {
    writeFileSync(join(dir, 'a.ts'), 'function auto() {}\n');
    const engine = new ConsensusEngine({ llm, registryGet, projectRoot: dir });
    // Protected field access via any-cast for white-box test
    const effective = (engine as any).effectiveXrefIndex;
    expect(effective).toBeDefined();
    expect(effective.definedAt('auto')).toHaveLength(1);
  });

  it('includes XREF_TOOLS in verifierTools when xref is active', () => {
    writeFileSync(join(dir, 'a.ts'), 'function auto() {}\n');
    const engine = new ConsensusEngine({ llm, registryGet, projectRoot: dir });
    const tools = (engine as any).verifierTools as Array<{ name: string }>;
    const names = tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'xref_callers_of', 'xref_calls_of', 'xref_defined_at',
    ]));
  });

  it('prefers an explicitly provided xrefIndex over auto-build', () => {
    writeFileSync(join(dir, 'a.ts'), 'function realFn() {}');
    // Pre-build and use a different one with a distinctive signal
    const otherDir = mkdtempSync(join(tmpdir(), 'xref-other-'));
    try {
      writeFileSync(join(otherDir, 'b.ts'), 'function providedFn() {}');
      const pre = buildProjectXrefIndex(otherDir);
      const engine = new ConsensusEngine({
        llm, registryGet, projectRoot: dir, xrefIndex: pre.index,
      });
      const eff = (engine as any).effectiveXrefIndex;
      // Should be the provided one — sees providedFn, not realFn
      expect(eff.definedAt('providedFn')).toHaveLength(1);
      expect(eff.definedAt('realFn')).toHaveLength(0);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('skips auto-build when GOSSIP_DISABLE_XREF=1', () => {
    writeFileSync(join(dir, 'a.ts'), 'function skipMe() {}');
    process.env.GOSSIP_DISABLE_XREF = '1';
    const engine = new ConsensusEngine({ llm, registryGet, projectRoot: dir });
    expect((engine as any).effectiveXrefIndex).toBeUndefined();
    // verifierTools should not include xref tools
    const tools = (engine as any).verifierTools as Array<{ name: string }>;
    const names = tools.map(t => t.name);
    expect(names).not.toContain('xref_callers_of');
  });

  it('skips auto-build when no projectRoot is set', () => {
    const engine = new ConsensusEngine({ llm, registryGet });
    expect((engine as any).effectiveXrefIndex).toBeUndefined();
  });
});
