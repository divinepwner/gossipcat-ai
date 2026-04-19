import {
  extractFromGo,
  stripGoCommentsAndStrings,
  buildXrefIndexFromFiles,
  languageOf,
} from '@gossip/orchestrator';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stripGoCommentsAndStrings', () => {
  it('strips line comments', () => {
    const src = 'x := 1 // a note\ny := 2';
    const out = stripGoCommentsAndStrings(src);
    expect(out).not.toContain('note');
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('strips block comments while preserving newlines', () => {
    const src = 'x := 1\n/* multi\nline\n*/\ny := 2';
    const out = stripGoCommentsAndStrings(src);
    expect(out).not.toContain('multi');
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('strips backtick raw strings across lines', () => {
    const src = 'x := `hello\nworld`\ny := 1';
    const out = stripGoCommentsAndStrings(src);
    expect(out).not.toContain('hello');
    expect(out).not.toContain('world');
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });
});

describe('extractFromGo — definitions', () => {
  it('finds top-level funcs', () => {
    const src = 'func Alpha() int { return 1 }\nfunc beta(x int) int { return x }\n';
    const r = extractFromGo('/t/a.go', src);
    const names = r.defs.map(d => d.name).sort();
    expect(names).toEqual(['Alpha', 'beta']);
    expect(r.defs.every(d => d.language === 'go')).toBe(true);
    expect(r.defs.every(d => d.kind === 'function')).toBe(true);
  });

  it('attributes methods to their receiver type', () => {
    const src = [
      'func (u *User) Name() string { return u.name }',
      'func (u *User) Age() int { return u.age }',
      'func (s Service) Run() {}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const methods = r.defs.filter(d => d.kind === 'method');
    expect(methods).toHaveLength(3);
    const byName = Object.fromEntries(methods.map(m => [m.name, m.className]));
    expect(byName.Name).toBe('User');
    expect(byName.Age).toBe('User');
    expect(byName.Run).toBe('Service');
  });

  it('records line ranges using matching braces', () => {
    const src = [
      'func foo() {',
      '  a := 1',
      '  b := 2',
      '}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const foo = r.defs.find(d => d.name === 'foo')!;
    expect(foo.startLine).toBe(1);
    expect(foo.endLine).toBe(4);
  });
});

describe('extractFromGo — call sites', () => {
  it('finds bare-name calls inside a func', () => {
    const src = [
      'func caller() {',
      '  helper()',
      '  other()',
      '}',
      'func helper() {}',
      'func other() {}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const callees = r.calls.filter(c => c.callerName === 'caller').map(c => c.calleeName).sort();
    expect(callees).toEqual(['helper', 'other']);
  });

  it('attributes method calls to Receiver.method', () => {
    const src = [
      'func (u *User) Save() {',
      '  db.Put(u)',
      '}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const putCall = r.calls.find(c => c.calleeName === 'Put')!;
    expect(putCall.callerName).toBe('User.Save');
  });

  it('skips Go control-flow keywords', () => {
    const src = [
      'func f() {',
      '  if x := 1; x > 0 {',
      '    for i := 0; i < 3; i++ {',
      '      doThing()',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).not.toContain('if');
    expect(callees).not.toContain('for');
    expect(callees).toContain('doThing');
  });

  it('ignores content inside raw strings', () => {
    const src = [
      'func f() {',
      '  s := `bar()` ',
      '  realCall()',
      '}',
    ].join('\n');
    const r = extractFromGo('/t/a.go', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).toContain('realCall');
    expect(callees).not.toContain('bar');
  });
});

describe('buildXrefIndex — Go integration', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xref-go-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('builds an index from a .go file', () => {
    const f = join(dir, 'sample.go');
    writeFileSync(f, 'func foo() { bar() }\nfunc bar() {}\n');
    const { index, errors } = buildXrefIndexFromFiles([f]);
    expect(errors).toEqual([]);
    expect(index.callersOf('bar')).toHaveLength(1);
    expect(index.definedAt('foo')).toHaveLength(1);
    expect(index.definedAt('foo')[0].language).toBe('go');
  });

  it('go dispatch is wired in languageOf', () => {
    expect(languageOf('x.go')).toBe('go');
  });
});
