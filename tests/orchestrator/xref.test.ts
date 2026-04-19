import {
  extractFromSource,
  stripCommentsAndStrings,
  buildXrefIndex,
  buildXrefIndexFromFiles,
  isSupportedXrefFile,
  XREF_TOOLS,
  XREF_TOOL_NAMES,
  isXrefTool,
  runXrefTool,
} from '@gossip/orchestrator';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stripCommentsAndStrings', () => {
  it('replaces line comments with spaces, preserving line count', () => {
    const src = 'const x = 1; // a comment\nconst y = 2;';
    const out = stripCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('comment');
    expect(out).toContain('const x = 1;');
  });

  it('replaces block comments while keeping newlines for line accounting', () => {
    const src = 'const x = 1;\n/* multi\nline\ncomment */\nconst y = 2;';
    const out = stripCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('multi');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('const y = 2;');
  });

  it('blanks string contents but keeps quote positions', () => {
    const src = 'const s = "hello world";';
    const out = stripCommentsAndStrings(src);
    expect(out).not.toContain('hello');
    expect(out.length).toBe(src.length);
  });

  it('handles template literals with newlines', () => {
    const src = 'const t = `line 1\nline 2`;\nconst y = 1;';
    const out = stripCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('line 1');
  });

  it('respects escaped quotes in strings', () => {
    const src = `const s = "he said \\"hi\\"";\nconst y = 1;`;
    const out = stripCommentsAndStrings(src);
    expect(out).toContain('const y = 1;');
  });
});

describe('extractFromSource — function definitions', () => {
  it('finds top-level function declarations', () => {
    const src = `
export function alpha() { return 1; }
function beta(x: number) { return x; }
async function gamma() { await something(); }
`;
    const r = extractFromSource('/t/a.ts', src);
    const names = r.defs.map(d => d.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.defs.find(d => d.name === 'alpha')!.kind).toBe('function');
  });

  it('finds arrow function variable declarations', () => {
    const src = `
export const handler = (req: Request) => {
  return new Response();
};
const tiny = () => 1;
`;
    const r = extractFromSource('/t/a.ts', src);
    const arrows = r.defs.filter(d => d.kind === 'arrow').map(d => d.name).sort();
    expect(arrows).toEqual(['handler', 'tiny']);
  });

  it('finds class methods with className attribution', () => {
    const src = `
class UserService {
  public findById(id: string) {
    return this.repo.find(id);
  }
  private async hash(pw: string): Promise<string> {
    return await argon2.hash(pw);
  }
}
`;
    const r = extractFromSource('/t/svc.ts', src);
    const methods = r.defs.filter(d => d.kind === 'method');
    expect(methods.map(m => m.name).sort()).toEqual(['findById', 'hash']);
    expect(methods.every(m => m.className === 'UserService')).toBe(true);
  });

  it('records line ranges that span the function body', () => {
    const src = [
      'function foo() {',
      '  const a = 1;',
      '  return a;',
      '}',
    ].join('\n');
    const r = extractFromSource('/t/a.ts', src);
    const foo = r.defs.find(d => d.name === 'foo')!;
    expect(foo.startLine).toBe(1);
    expect(foo.endLine).toBe(4);
  });

  it('captures the signature line (truncated, no body)', () => {
    const src = 'export function calc(a: number, b: number): number { return a + b; }';
    const r = extractFromSource('/t/a.ts', src);
    expect(r.defs[0].signature).toContain('function calc');
    expect(r.defs[0].signature.length).toBeLessThanOrEqual(240);
  });
});

describe('extractFromSource — call sites', () => {
  it('finds bare-name calls and attributes them to the enclosing function', () => {
    const src = `
function caller() {
  helper();
  another();
}

function helper() { return 1; }
function another() { return 2; }
`;
    const r = extractFromSource('/t/a.ts', src);
    const insideCaller = r.calls.filter(c => c.callerName === 'caller');
    const callees = insideCaller.map(c => c.calleeName).sort();
    expect(callees).toEqual(['another', 'helper']);
  });

  it('records method-style calls by the unqualified name', () => {
    const src = `
function go() {
  obj.run();
  this.compute(1);
}
`;
    const r = extractFromSource('/t/a.ts', src);
    const callees = r.calls.filter(c => c.callerName === 'go').map(c => c.calleeName).sort();
    expect(callees).toEqual(['compute', 'run']);
  });

  it('attributes call to <top> when at module scope', () => {
    const src = `setupGlobal();\nfunction foo() {}`;
    const r = extractFromSource('/t/a.ts', src);
    const setup = r.calls.find(c => c.calleeName === 'setupGlobal')!;
    expect(setup.callerName).toBe('<top>');
  });

  it('skips control-flow keywords that visually look like calls', () => {
    const src = `
function f() {
  if (true) {
    while (false) {
      doThing();
    }
  }
}
`;
    const r = extractFromSource('/t/a.ts', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).not.toContain('if');
    expect(callees).not.toContain('while');
    expect(callees).toContain('doThing');
  });

  it('does not surface "function name(" itself as a call site', () => {
    const src = `function foo() { bar(); }`;
    const r = extractFromSource('/t/a.ts', src);
    const fooCalls = r.calls.filter(c => c.calleeName === 'foo');
    expect(fooCalls).toHaveLength(0);
  });

  it('ignores text inside string literals', () => {
    const src = `function foo() {
  const s = "bar(); baz();";
  realCall();
}`;
    const r = extractFromSource('/t/a.ts', src);
    const callees = r.calls.filter(c => c.callerName === 'foo').map(c => c.calleeName);
    expect(callees).toContain('realCall');
    expect(callees).not.toContain('bar');
    expect(callees).not.toContain('baz');
  });

  it('ignores text inside block comments', () => {
    const src = `function foo() {
  /* shouldNotBeFound(); */
  realCall();
}`;
    const r = extractFromSource('/t/a.ts', src);
    const callees = r.calls.filter(c => c.callerName === 'foo').map(c => c.calleeName);
    expect(callees).toContain('realCall');
    expect(callees).not.toContain('shouldNotBeFound');
  });

  it('attributes calls inside a method to ClassName.method', () => {
    const src = `
class Repo {
  find(id: string) {
    db.query(id);
  }
}
`;
    const r = extractFromSource('/t/a.ts', src);
    const queryCall = r.calls.find(c => c.calleeName === 'query')!;
    expect(queryCall.callerName).toBe('Repo.find');
  });
});

describe('buildXrefIndex — query layer', () => {
  const src = `
function inner() { return 1; }
function caller() {
  inner();
  helper();
  helper();
}
function helper() { return 2; }
`;
  const { defs, calls } = extractFromSource('/t/a.ts', src);
  const index = buildXrefIndex({ defs, calls });

  it('callersOf returns every site invoking the symbol', () => {
    const callers = index.callersOf('helper');
    expect(callers).toHaveLength(2);
    expect(callers.every(c => c.callerName === 'caller')).toBe(true);
  });

  it('callersOf returns empty for an undefined symbol', () => {
    expect(index.callersOf('zzz')).toEqual([]);
  });

  it('callsOf flattens the calls inside the named symbol body', () => {
    const inside = index.callsOf('caller');
    const callees = inside.map(c => c.calleeName).sort();
    expect(callees).toEqual(['helper', 'helper', 'inner']);
  });

  it('definedAt returns every definition record for the symbol', () => {
    const defs = index.definedAt('helper');
    expect(defs).toHaveLength(1);
    expect(defs[0].kind).toBe('function');
  });

  it('size reports counts derived from the input', () => {
    const sz = index.size();
    expect(sz.defs).toBe(3);
    expect(sz.files).toBe(1);
    expect(sz.calls).toBeGreaterThan(0);
  });

  it('mutating returned arrays does not corrupt subsequent queries', () => {
    const a = index.callersOf('helper');
    a.length = 0;
    const b = index.callersOf('helper');
    expect(b).toHaveLength(2);
  });
});

describe('buildXrefIndexFromFiles — disk integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xref-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads, extracts, and indexes a small TS file', () => {
    const f = join(dir, 'sample.ts');
    writeFileSync(f, 'function foo() { bar(); }\nfunction bar() {}\n');
    const { index, errors } = buildXrefIndexFromFiles([f]);
    expect(errors).toEqual([]);
    expect(index.callersOf('bar')).toHaveLength(1);
    expect(index.definedAt('foo')).toHaveLength(1);
  });

  it('skips unsupported extensions silently', () => {
    const f = join(dir, 'note.md');
    writeFileSync(f, '# heading\nfunction foo() {}\n');
    const { index, errors } = buildXrefIndexFromFiles([f]);
    expect(errors).toEqual([]);
    expect(index.size().defs).toBe(0);
  });

  it('records read errors but continues with other files', () => {
    const good = join(dir, 'good.ts');
    writeFileSync(good, 'function ok() {}');
    const missing = join(dir, 'missing.ts');
    const { index, errors } = buildXrefIndexFromFiles([missing, good]);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe(missing);
    expect(index.definedAt('ok')).toHaveLength(1);
  });
});

describe('isSupportedXrefFile', () => {
  it('accepts ts/tsx/js/jsx/mjs/cjs', () => {
    expect(isSupportedXrefFile('a.ts')).toBe(true);
    expect(isSupportedXrefFile('a.tsx')).toBe(true);
    expect(isSupportedXrefFile('a.js')).toBe(true);
    expect(isSupportedXrefFile('a.jsx')).toBe(true);
    expect(isSupportedXrefFile('a.mjs')).toBe(true);
    expect(isSupportedXrefFile('a.cjs')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isSupportedXrefFile('a.py')).toBe(false);
    expect(isSupportedXrefFile('a.md')).toBe(false);
    expect(isSupportedXrefFile('Makefile')).toBe(false);
  });
});

describe('XREF_TOOLS shape', () => {
  it('exports three tools with required parameters', () => {
    expect(XREF_TOOLS).toHaveLength(3);
    for (const t of XREF_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.parameters.required).toEqual(['symbol']);
      expect(t.parameters.properties.symbol).toBeDefined();
    }
  });

  it('isXrefTool matches the tool names', () => {
    expect(isXrefTool(XREF_TOOL_NAMES.callersOf)).toBe(true);
    expect(isXrefTool(XREF_TOOL_NAMES.callsOf)).toBe(true);
    expect(isXrefTool(XREF_TOOL_NAMES.definedAt)).toBe(true);
    expect(isXrefTool('file_read')).toBe(false);
    expect(isXrefTool('unknown')).toBe(false);
  });
});

describe('runXrefTool', () => {
  const src = `
function caller() { helper(); helper(); }
function helper() { return 1; }
`;
  const { defs, calls } = extractFromSource('/t/a.ts', src);
  const index = buildXrefIndex({ defs, calls });

  it('returns JSON with callers count', () => {
    const out = runXrefTool(index, XREF_TOOL_NAMES.callersOf, { symbol: 'helper' });
    const parsed = JSON.parse(out);
    expect(parsed.symbol).toBe('helper');
    expect(parsed.count).toBe(2);
    expect(parsed.callers).toHaveLength(2);
  });

  it('returns JSON with calls count', () => {
    const out = runXrefTool(index, XREF_TOOL_NAMES.callsOf, { symbol: 'caller' });
    const parsed = JSON.parse(out);
    expect(parsed.calls.map((c: any) => c.calleeName)).toEqual(['helper', 'helper']);
  });

  it('returns JSON with definition records', () => {
    const out = runXrefTool(index, XREF_TOOL_NAMES.definedAt, { symbol: 'helper' });
    const parsed = JSON.parse(out);
    expect(parsed.definitions).toHaveLength(1);
    expect(parsed.definitions[0]).toHaveProperty('startLine');
    expect(parsed.definitions[0]).toHaveProperty('endLine');
    expect(parsed.definitions[0]).toHaveProperty('signature');
  });

  it('returns an error payload when symbol is missing', () => {
    const out = runXrefTool(index, XREF_TOOL_NAMES.callersOf, {});
    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/missing.*symbol/);
  });

  it('returns an error payload for unknown tool name', () => {
    const out = runXrefTool(index, 'xref_made_up' as any, { symbol: 'x' });
    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/unknown xref tool/);
  });
});
