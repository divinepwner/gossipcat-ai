/**
 * Go symbol extractor — conforms to `./types.ts` Extractor contract.
 *
 * Go specifics handled:
 *   - `func Name(...) T { ... }` top-level functions
 *   - `func (r Receiver) Name(...) T { ... }` methods — the method's
 *     `className` is the receiver type (stripping any leading `*`).
 *   - Brace-delimited bodies — endLine is the matching `}`.
 *   - `//` line comments and C-style block comments.
 *   - Raw strings with backticks.
 *
 * Limitations (MVP):
 *   - Method-value and method-expression calls (`T.Method(...)`) are
 *     counted as calls to `Method` (by method-call regex, same as `.Method`).
 *   - Goroutines `go foo()` register `foo` as a normal call.
 *   - Generic type parameters in brackets (`[T any]`) are tolerated but
 *     not captured in signatures beyond the 240-char truncation.
 */

import type { CallSite, ExtractResult, FunctionDef } from './types';

const LANG = 'go' as const;

/**
 * Top-level function: `func Name(` (no receiver).
 * Method: `func (r Receiver) Name(` — the receiver is captured in group 2.
 */
const FUNC_RE = /\bfunc\s+([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?\s*\(/;
const METHOD_RE = /\bfunc\s+\(\s*[A-Za-z_][\w]*\s+\*?([A-Za-z_][\w]*)\s*\)\s+([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?\s*\(/;

const CALL_RE = /(?:^|[^.\w])([A-Za-z_][\w]*)\s*\(/g;
const METHOD_CALL_RE = /\.([A-Za-z_][\w]*)\s*\(/g;

const NON_CALL_KEYWORDS = new Set([
  'if', 'for', 'switch', 'select', 'return', 'go', 'defer', 'func',
  'chan', 'range', 'case', 'struct', 'interface', 'map', 'type',
  'package', 'import', 'var', 'const',
]);

export function stripGoCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) out.push(source[k] === '\n' ? '\n' : ' ');
      i = stop;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    // raw string (backtick) — may contain newlines
    if (c === '`') {
      out.push(' ');
      i++;
      while (i < n && source[i] !== '`') {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out.push(' '); i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out.push(' ');
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') { out.push(' ', ' '); i += 2; continue; }
        if (ch === quote || ch === '\n') {
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

export function extractFromGo(file: string, source: string): ExtractResult {
  const cleaned = stripGoCommentsAndStrings(source);
  const defs: FunctionDef[] = [];
  const calls: CallSite[] = [];

  // Methods first — their regex is more specific, so matching methods before
  // plain funcs avoids double-counting.
  const methodRanges: Array<{ start: number; end: number }> = [];
  {
    const re = new RegExp(METHOD_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[2];
      const receiver = m[1];
      const startLine = offsetToLine(cleaned, m.index);
      const openIdx = cleaned.indexOf('{', m.index);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      methodRanges.push({ start: m.index, end: openIdx === -1 ? m.index : openIdx });
      defs.push({
        name, file, startLine, endLine,
        signature: signatureAt(source, startLine),
        kind: 'method',
        className: receiver,
        language: LANG,
      });
    }
  }

  // Plain funcs — skip any match whose start overlaps with a method header.
  {
    const re = new RegExp(FUNC_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      if (methodRanges.some(r => m!.index >= r.start && m!.index <= r.end)) continue;
      const name = m[1];
      const startLine = offsetToLine(cleaned, m.index);
      const openIdx = cleaned.indexOf('{', m.index);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      defs.push({
        name, file, startLine, endLine,
        signature: signatureAt(source, startLine),
        kind: 'function',
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
    const fn = line.match(FUNC_RE);
    if (fn && fn[1] === name) return true;
    const mth = line.match(METHOD_RE);
    if (mth && mth[2] === name) return true;
    return false;
  };

  // bare-name calls
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
