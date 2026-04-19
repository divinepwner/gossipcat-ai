import {
  extractFromPython,
  stripPythonCommentsAndStrings,
  buildXrefIndex,
  buildXrefIndexFromFiles,
  languageOf,
  extractorFor,
} from '@gossip/orchestrator';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stripPythonCommentsAndStrings', () => {
  it('strips `#` line comments while preserving line count', () => {
    const src = 'x = 1  # a comment\ny = 2';
    const out = stripPythonCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('comment');
    expect(out).toContain('x = 1');
  });

  it('strips triple-quoted docstrings across lines', () => {
    const src = 'def f():\n    """\n    hello\n    """\n    pass';
    const out = stripPythonCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('hello');
    expect(out).toContain('def f():');
    expect(out).toContain('pass');
  });

  it('strips single-line string contents', () => {
    const src = 'name = "Alice"\nprint(name)';
    const out = stripPythonCommentsAndStrings(src);
    expect(out).not.toContain('Alice');
    expect(out).toContain('name = ');
    expect(out).toContain('print(name)');
  });
});

describe('extractFromPython — definitions', () => {
  it('finds top-level def', () => {
    const src = 'def alpha():\n    return 1\n\ndef beta(x):\n    return x\n';
    const r = extractFromPython('/t/a.py', src);
    const names = r.defs.map(d => d.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
    for (const d of r.defs) expect(d.language).toBe('python');
  });

  it('attributes methods to their class', () => {
    const src = [
      'class UserService:',
      '    def find(self, id):',
      '        return self.repo.get(id)',
      '    def save(self, user):',
      '        self.repo.put(user)',
    ].join('\n');
    const r = extractFromPython('/t/svc.py', src);
    const methods = r.defs.filter(d => d.kind === 'method');
    expect(methods.map(m => m.name).sort()).toEqual(['find', 'save']);
    expect(methods.every(m => m.className === 'UserService')).toBe(true);
  });

  it('records end line based on indentation', () => {
    const src = [
      'def foo():',
      '    x = 1',
      '    y = 2',
      '',
      'def bar():',
      '    pass',
    ].join('\n');
    const r = extractFromPython('/t/a.py', src);
    const foo = r.defs.find(d => d.name === 'foo')!;
    expect(foo.startLine).toBe(1);
    // foo's body ends before `def bar` at same indent
    expect(foo.endLine).toBeGreaterThanOrEqual(3);
    expect(foo.endLine).toBeLessThanOrEqual(5);
  });

  it('async def is captured like def', () => {
    const src = 'async def handler(req):\n    return 1\n';
    const r = extractFromPython('/t/a.py', src);
    expect(r.defs.map(d => d.name)).toEqual(['handler']);
  });
});

describe('extractFromPython — call sites', () => {
  it('finds bare-name calls inside a function', () => {
    const src = [
      'def caller():',
      '    helper()',
      '    other()',
      'def helper():',
      '    pass',
      'def other():',
      '    pass',
    ].join('\n');
    const r = extractFromPython('/t/a.py', src);
    const insideCaller = r.calls.filter(c => c.callerName === 'caller').map(c => c.calleeName).sort();
    expect(insideCaller).toEqual(['helper', 'other']);
  });

  it('finds method-style calls via .name(', () => {
    const src = 'def go():\n    obj.run()\n    self.compute(1)\n';
    const r = extractFromPython('/t/a.py', src);
    const callees = r.calls.filter(c => c.callerName === 'go').map(c => c.calleeName).sort();
    expect(callees).toContain('run');
    expect(callees).toContain('compute');
  });

  it('ignores calls inside string literals', () => {
    const src = 'def foo():\n    s = "bar()"\n    realCall()\n';
    const r = extractFromPython('/t/a.py', src);
    const callees = r.calls.filter(c => c.callerName === 'foo').map(c => c.calleeName);
    expect(callees).toContain('realCall');
    expect(callees).not.toContain('bar');
  });

  it('attributes method calls to ClassName.method', () => {
    const src = [
      'class Repo:',
      '    def find(self, id):',
      '        self.cache.get(id)',
    ].join('\n');
    const r = extractFromPython('/t/a.py', src);
    const getCall = r.calls.find(c => c.calleeName === 'get')!;
    expect(getCall.callerName).toBe('Repo.find');
  });

  it('skips control-flow keywords that visually look like calls', () => {
    const src = [
      'def f():',
      '    if True:',
      '        while False:',
      '            doThing()',
    ].join('\n');
    const r = extractFromPython('/t/a.py', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).not.toContain('if');
    expect(callees).not.toContain('while');
    expect(callees).toContain('doThing');
  });
});

describe('buildXrefIndex — Python integration', () => {
  const src = [
    'def inner():',
    '    return 1',
    'def caller():',
    '    inner()',
    '    helper()',
    '    helper()',
    'def helper():',
    '    return 2',
  ].join('\n');
  const r = extractFromPython('/t/a.py', src);
  const index = buildXrefIndex({ defs: r.defs, calls: r.calls });

  it('callersOf counts all invocations', () => {
    expect(index.callersOf('helper')).toHaveLength(2);
  });

  it('callsOf enumerates calls inside a body', () => {
    const callees = index.callsOf('caller').map(c => c.calleeName).sort();
    expect(callees).toEqual(['helper', 'helper', 'inner']);
  });

  it('definedAt returns Python-language records', () => {
    const defs = index.definedAt('helper');
    expect(defs).toHaveLength(1);
    expect(defs[0].language).toBe('python');
  });
});

describe('buildXrefIndexFromFiles — dispatches to Python extractor', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xref-py-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('builds an index from a .py file', () => {
    const f = join(dir, 'sample.py');
    writeFileSync(f, 'def foo():\n    bar()\ndef bar():\n    pass\n');
    const { index, errors } = buildXrefIndexFromFiles([f]);
    expect(errors).toEqual([]);
    expect(index.callersOf('bar')).toHaveLength(1);
    expect(index.definedAt('foo')).toHaveLength(1);
    expect(index.definedAt('foo')[0].language).toBe('python');
  });
});

describe('languageOf / extractorFor', () => {
  it('maps .py and .pyi to python', () => {
    expect(languageOf('x.py')).toBe('python');
    expect(languageOf('x.pyi')).toBe('python');
    expect(extractorFor('x.py')).toBeDefined();
  });
});
