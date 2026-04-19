import {
  extractFromRust,
  stripRustCommentsAndStrings,
  buildXrefIndexFromFiles,
  languageOf,
} from '@gossip/orchestrator';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stripRustCommentsAndStrings', () => {
  it('handles nested block comments', () => {
    const src = 'let x = 1; /* outer /* inner */ still outer */ let y = 2;';
    const out = stripRustCommentsAndStrings(src);
    expect(out).not.toContain('outer');
    expect(out).not.toContain('inner');
    expect(out).toContain('let x = 1;');
    expect(out).toContain('let y = 2;');
  });

  it('strips raw strings with hashes', () => {
    const src = 'let s = r#"hello "world""#; let y = 1;';
    const out = stripRustCommentsAndStrings(src);
    expect(out).not.toContain('hello');
    expect(out).not.toContain('world');
    expect(out).toContain('let y = 1;');
  });

  it('preserves lifetime annotations', () => {
    const src = "fn foo<'a>(x: &'a str) -> &'a str { x }";
    const out = stripRustCommentsAndStrings(src);
    expect(out).toContain("'a");
    expect(out).toContain('fn foo');
  });

  it('strips char literals without clobbering lifetimes', () => {
    const src = "let c = 'x'; let name: &'static str = \"\";";
    const out = stripRustCommentsAndStrings(src);
    expect(out).toContain("'static");
  });
});

describe('extractFromRust — definitions', () => {
  it('finds free fn', () => {
    const src = 'pub fn alpha() -> i32 { 1 }\nfn beta(x: i32) -> i32 { x }\n';
    const r = extractFromRust('/t/a.rs', src);
    const names = r.defs.map(d => d.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
    expect(r.defs.every(d => d.language === 'rust')).toBe(true);
  });

  it('attributes methods inside impl blocks to the type', () => {
    const src = [
      'impl User {',
      '    pub fn name(&self) -> &str { &self.name }',
      '    pub fn age(&self) -> u32 { self.age }',
      '}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const methods = r.defs.filter(d => d.kind === 'method');
    expect(methods).toHaveLength(2);
    expect(methods.every(m => m.className === 'User')).toBe(true);
  });

  it('attributes methods in impl Trait for Type to the Type', () => {
    const src = [
      'impl Display for User {',
      '    fn fmt(&self, f: &mut Formatter) -> Result { Ok(()) }',
      '}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const fmt = r.defs.find(d => d.name === 'fmt')!;
    expect(fmt.kind).toBe('method');
    expect(fmt.className).toBe('User');
  });

  it('handles fn with generic parameters', () => {
    const src = 'fn map<T, U>(x: T, f: fn(T) -> U) -> U { f(x) }';
    const r = extractFromRust('/t/a.rs', src);
    expect(r.defs.map(d => d.name)).toEqual(['map']);
  });

  it('handles async fn and unsafe fn modifiers', () => {
    const src = [
      'async fn handle() {}',
      'pub async fn also() {}',
      'unsafe fn danger() {}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const names = r.defs.map(d => d.name).sort();
    expect(names).toEqual(['also', 'danger', 'handle']);
  });
});

describe('extractFromRust — call sites', () => {
  it('finds bare-name calls', () => {
    const src = [
      'fn caller() {',
      '    helper();',
      '    other();',
      '}',
      'fn helper() {}',
      'fn other() {}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const callees = r.calls.filter(c => c.callerName === 'caller').map(c => c.calleeName).sort();
    expect(callees).toEqual(['helper', 'other']);
  });

  it('attributes method calls to Type.method', () => {
    const src = [
      'impl User {',
      '    pub fn save(&self) {',
      '        self.repo.put();',
      '    }',
      '}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const put = r.calls.find(c => c.calleeName === 'put')!;
    expect(put.callerName).toBe('User.save');
  });

  it('ignores Rust keywords that could look like calls', () => {
    const src = [
      'fn f() {',
      '    if true {',
      '        while false {',
      '            doThing();',
      '        }',
      '    }',
      '}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).not.toContain('if');
    expect(callees).not.toContain('while');
    expect(callees).toContain('doThing');
  });

  it('ignores nested block comment content', () => {
    const src = [
      'fn f() {',
      '    /* inside /* nested */ still */',
      '    realCall();',
      '}',
    ].join('\n');
    const r = extractFromRust('/t/a.rs', src);
    const callees = r.calls.filter(c => c.callerName === 'f').map(c => c.calleeName);
    expect(callees).toContain('realCall');
  });
});

describe('buildXrefIndex — Rust integration', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xref-rs-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('builds an index from a .rs file', () => {
    const f = join(dir, 'sample.rs');
    writeFileSync(f, 'fn foo() { bar(); }\nfn bar() {}\n');
    const { index, errors } = buildXrefIndexFromFiles([f]);
    expect(errors).toEqual([]);
    expect(index.callersOf('bar')).toHaveLength(1);
    expect(index.definedAt('foo')).toHaveLength(1);
    expect(index.definedAt('foo')[0].language).toBe('rust');
  });

  it('rust dispatch is wired in languageOf', () => {
    expect(languageOf('x.rs')).toBe('rust');
  });
});
