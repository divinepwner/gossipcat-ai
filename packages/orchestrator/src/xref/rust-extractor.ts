/**
 * Rust symbol extractor — conforms to `./types.ts` Extractor contract.
 *
 * Rust specifics handled:
 *   - `fn name(...) -> T { ... }` free functions, with generic and
 *     lifetime parameters in brackets.
 *   - `impl Type { fn method(...) {} }` — methods inside an impl block
 *     get `className = Type`.
 *   - `impl Trait for Type { fn method(...) {} }` — same: className = Type.
 *   - `pub`, `pub(crate)`, `async`, `unsafe`, `const`, `extern` modifiers
 *     before `fn`.
 *   - `//` line comments, nestable block comments (Rust allows nested
 *     pairs, so the stripper tracks depth).
 *   - String literals `"..."`, raw strings `r"..."`, `r#"..."#`, char `'x'`.
 *
 * Limitations (MVP):
 *   - Macro invocations like `println!(...)` are not captured as calls.
 *   - `self.foo()` registers `foo` as a method call via METHOD_CALL_RE.
 *   - Trait-default method bodies inside `trait Foo { fn bar() {} }` are
 *     treated the same as impl methods — className = the trait name.
 *   - Closures (`|x| x + 1`) are not extracted as defs.
 */

import type { CallSite, ExtractResult, FunctionDef } from './types';

const LANG = 'rust' as const;

const FN_RE = /\b(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|const\s+|extern(?:\s+"[^"]*")?\s+)*fn\s+([A-Za-z_][\w]*)\s*(?:<[^>]*>)?\s*\(/;
/**
 * `impl Type {` or `impl<T> Type {` or `impl Trait for Type {`. Captures the
 * type name (the `Type` following `for` when present, else the name after
 * `impl`).
 */
const IMPL_RE = /\bimpl\s*(?:<[^>]*>)?\s*(?:[^{]+?\s+for\s+)?([A-Za-z_][\w]*)(?:<[^>]*>)?\s*(?:where[^{]+)?\s*\{/;
/** `trait Foo {` — trait default-methods behave like impl methods in MVP. */
const TRAIT_RE = /\btrait\s+([A-Za-z_][\w]*)(?:<[^>]*>)?(?:\s*:[^{]+)?\s*\{/;

const CALL_RE = /(?:^|[^.\w:])([A-Za-z_][\w]*)\s*\(/g;
const METHOD_CALL_RE = /\.([A-Za-z_][\w]*)\s*\(/g;

const NON_CALL_KEYWORDS = new Set([
  'if', 'while', 'for', 'match', 'return', 'fn', 'let', 'mut', 'ref',
  'struct', 'enum', 'impl', 'trait', 'mod', 'use', 'as', 'where',
  'async', 'await', 'move', 'self', 'Self', 'super', 'pub', 'crate',
  'unsafe', 'const', 'static', 'type', 'dyn', 'box',
  'true', 'false', 'loop', 'in', 'extern',
]);

export function stripRustCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    // Nested block comments
    if (c === '/' && c2 === '*') {
      let depth = 1;
      out.push(' ', ' ');
      i += 2;
      while (i < n && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth++;
          out.push(' ', ' ');
          i += 2;
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth--;
          out.push(' ', ' ');
          i += 2;
        } else {
          out.push(source[i] === '\n' ? '\n' : ' ');
          i++;
        }
      }
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    // Raw string: r"..." or r#"..."# or r##"..."##
    if (c === 'r' && (source[i + 1] === '"' || source[i + 1] === '#')) {
      let hashes = 0;
      let j = i + 1;
      while (source[j] === '#') { hashes++; j++; }
      if (source[j] === '"') {
        out.push(' ');
        for (let k = i + 1; k <= j; k++) out.push(' ');
        i = j + 1;
        while (i < n) {
          if (source[i] === '"') {
            let matchHashes = 0;
            while (matchHashes < hashes && source[i + 1 + matchHashes] === '#') matchHashes++;
            if (matchHashes === hashes) {
              out.push(' ');
              for (let k = 0; k < hashes; k++) out.push(' ');
              i += 1 + hashes;
              break;
            }
          }
          out.push(source[i] === '\n' ? '\n' : ' ');
          i++;
        }
        continue;
      }
    }
    if (c === '"') {
      out.push(' ');
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') { out.push(' ', ' '); i += 2; continue; }
        if (ch === '"' || ch === '\n') {
          out.push(ch === '\n' ? '\n' : ' ');
          i++;
          break;
        }
        out.push(' ');
        i++;
      }
      continue;
    }
    // Char literal 'x' — avoid swallowing lifetimes like 'a. A char literal
    // is 'X' or '\X' with a closing quote within 4 chars.
    if (c === "'") {
      // Lifetime detection: `'a` (single tick + ident, no closing quote before whitespace)
      const after = source[i + 1];
      if (after && /[A-Za-z_]/.test(after)) {
        // Look ahead: lifetime if next non-ident char is NOT a quote
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
        if (source[j] !== "'") {
          // It's a lifetime — leave it alone
          out.push(c);
          i++;
          continue;
        }
      }
      out.push(' ');
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') { out.push(' ', ' '); i += 2; continue; }
        if (ch === "'" || ch === '\n') {
          out.push(ch === '\n' ? '\n' : ' ');
          i++;
          break;
        }
        out.push(' ');
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function findClosingBrace(cleaned: string, openOffset: number): number {
  let depth = 0;
  let started = false;
  for (let i = openOffset; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return i; }
  }
  return -1;
}

function signatureAt(source: string, line1: number): string {
  let cur = 1;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (cur === line1) { start = i; break; }
    if (source[i] === '\n') cur++;
  }
  const end = source.indexOf('\n', start);
  const raw = end === -1 ? source.slice(start) : source.slice(start, end);
  return raw.trim().slice(0, 240);
}

export function extractFromRust(file: string, source: string): ExtractResult {
  const cleaned = stripRustCommentsAndStrings(source);
  const defs: FunctionDef[] = [];
  const calls: CallSite[] = [];

  // Collect impl / trait blocks — used to assign className to methods.
  interface ImplBlock { typeName: string; openOffset: number; closeOffset: number }
  const impls: ImplBlock[] = [];
  for (const re of [new RegExp(IMPL_RE.source, 'g'), new RegExp(TRAIT_RE.source, 'g')]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const openIdx = cleaned.indexOf('{', m.index + m[0].length - 1);
      if (openIdx === -1) continue;
      const closeIdx = findClosingBrace(cleaned, openIdx);
      if (closeIdx === -1) continue;
      impls.push({ typeName: m[1], openOffset: openIdx, closeOffset: closeIdx });
    }
  }

  const implAt = (offset: number): string | undefined => {
    let best: ImplBlock | undefined;
    for (const im of impls) {
      if (offset > im.openOffset && offset < im.closeOffset) {
        if (!best || im.openOffset > best.openOffset) best = im;
      }
    }
    return best?.typeName;
  };

  // fn definitions
  {
    const re = new RegExp(FN_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[1];
      const startLine = offsetToLine(cleaned, m.index);
      const openIdx = cleaned.indexOf('{', m.index);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      const className = implAt(m.index);
      defs.push({
        name, file, startLine, endLine,
        signature: signatureAt(source, startLine),
        kind: className ? 'method' : 'function',
        ...(className ? { className } : {}),
        language: LANG,
      });
    }
  }

  const enclosingFor = (line1: number): string => {
    let best: FunctionDef | null = null;
    for (const d of defs) {
      if (line1 >= d.startLine && line1 <= d.endLine) {
        if (!best || (d.endLine - d.startLine) < (best.endLine - best.startLine)) best = d;
      }
    }
    return best ? (best.className ? `${best.className}.${best.name}` : best.name) : '<top>';
  };

  const declaredOnLine = (offset: number, name: string): boolean => {
    const lineStart = cleaned.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = cleaned.indexOf('\n', offset);
    const line = cleaned.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const fn = line.match(FN_RE);
    return !!(fn && fn[1] === name);
  };

  // bare-name calls — `[^.\w:]` before the name so we skip `::name(` too
  // (associated function calls like `Vec::new()` — the receiver-like path
  // is already lost, so counting these as calls to `new` is wrong).
  {
    const re = new RegExp(CALL_RE.source, CALL_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name)) continue;
      const matchOffset = m.index + m[0].indexOf(name);
      if (declaredOnLine(matchOffset, name)) continue;
      const line = offsetToLine(cleaned, matchOffset);
      calls.push({
        callerName: enclosingFor(line),
        callerFile: file,
        callerLine: line,
        calleeName: name,
        language: LANG,
      });
    }
  }

  // method calls
  {
    const re = new RegExp(METHOD_CALL_RE.source, METHOD_CALL_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name)) continue;
      const matchOffset = m.index + 1;
      const line = offsetToLine(cleaned, matchOffset);
      calls.push({
        callerName: enclosingFor(line),
        callerFile: file,
        callerLine: line,
        calleeName: name,
        language: LANG,
      });
    }
  }

  return { defs, calls };
}
