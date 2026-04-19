/**
 * Python symbol extractor — conforms to `./types.ts` Extractor contract.
 *
 * Python specifics handled:
 *   - Indentation-based scope (no braces). Function end is the last line
 *     at indent > the `def`'s own indent.
 *   - `def name(...):` top-level and nested functions
 *   - `class Name(Base):` with methods (`def` indented under `class`)
 *   - Decorators (`@cached`, `@staticmethod`) above a def are skipped when
 *     computing the definition line — the line of `def` itself is the
 *     authoritative startLine.
 *   - Triple-quoted docstrings and strings (both """…""" and '''…''')
 *   - f-strings and r-strings: the leading prefix is handled, expression
 *     content inside f-strings is not specifically parsed (treated as
 *     string for our purposes — conservative).
 *   - `#` line comments.
 *
 * Limitations (MVP):
 *   - Lambda expressions are not extracted as defs.
 *   - async def is treated identically to def.
 *   - Dynamic attribute access (`getattr`) is invisible.
 *   - Implicit `self.` is folded into the method caller name when the call
 *     is inside a method.
 */

import type { CallSite, ExtractResult, FunctionDef } from './types';

const LANG = 'python' as const;

/** Matches `def name(`, `async def name(`, optionally with leading whitespace. */
const DEF_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/;
/** Matches `class Name:` or `class Name(Base):` with leading whitespace captured. */
const CLASS_RE = /^(\s*)class\s+([A-Za-z_][\w]*)\s*[(:]/;
/** Bare-name call: `name(` preceded by non-dot, non-word. */
const CALL_RE = /(?:^|[^.\w])([A-Za-z_][\w]*)\s*\(/g;
/** Method-style call: `.name(`. */
const METHOD_CALL_RE = /\.([A-Za-z_][\w]*)\s*\(/g;
/** Python keywords and builtins that look like calls but are statements/types. */
const NON_CALL_KEYWORDS = new Set([
  'if', 'elif', 'else', 'while', 'for', 'return', 'yield', 'raise', 'except',
  'with', 'lambda', 'pass', 'def', 'class', 'try', 'finally', 'import', 'from',
  'as', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None',
  'self', 'super',
  // Control flow keywords that take parens
  'print',  // still often a call; keep? no — keep `print` as a call since it's a function in py3
]);
// Remove 'print' — it IS a call in py3
NON_CALL_KEYWORDS.delete('print');

/**
 * Strip comments and string contents. Preserves length and newline positions
 * so offsets/lines computed against the result map back to the original
 * source. String contents become spaces; quote characters stay in place.
 *
 * Triple quotes (`"""` / `'''`) span multiple lines and are the primary
 * reason a line-by-line strip doesn't work.
 */
export function stripPythonCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    // Line comment (# to EOL)
    if (c === '#') {
      while (i < n && source[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    // Triple-quoted strings
    if (
      (c === '"' || c === "'") &&
      source[i + 1] === c &&
      source[i + 2] === c
    ) {
      const quote = c;
      out.push(' ', ' ', ' ');
      i += 3;
      while (i < n) {
        if (
          source[i] === quote &&
          source[i + 1] === quote &&
          source[i + 2] === quote
        ) {
          out.push(' ', ' ', ' ');
          i += 3;
          break;
        }
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    // Single-line strings (possibly with r/f/b prefix already consumed as word chars)
    if (c === '"' || c === "'") {
      const quote = c;
      out.push(' ');
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
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

/** Count leading spaces/tabs on a line. Tabs count as 1; tests use spaces. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
}

/** Trim a line at max 240 chars and return the trimmed content. */
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

interface BlockStart {
  name: string;
  indent: number;
  startLine: number;
  kind: 'function' | 'method' | 'class';
  className?: string;
}

export function extractFromPython(file: string, source: string): ExtractResult {
  const cleaned = stripPythonCommentsAndStrings(source);
  const lines = cleaned.split('\n');
  const origLines = source.split('\n');

  const defs: FunctionDef[] = [];
  const calls: CallSite[] = [];

  // ── Pass 1: find def/class headers ───────────────────────────────────
  const starts: BlockStart[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const defMatch = line.match(DEF_RE);
    if (defMatch) {
      starts.push({
        name: defMatch[2],
        indent: defMatch[1].length,
        startLine: i + 1,
        kind: 'function',
      });
      continue;
    }
    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      starts.push({
        name: classMatch[2],
        indent: classMatch[1].length,
        startLine: i + 1,
        kind: 'class',
      });
    }
  }

  // Attribute className to nested defs: a def whose indent > some class's
  // indent, and which appears between that class's startLine and its end,
  // is a method of that class.
  const resolveEnd = (startIdx: number, ownIndent: number): number => {
    const startLine = starts[startIdx].startLine;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const ind = indentOf(line);
      if (ind <= ownIndent) return i; // 1-based end = i (the line BEFORE this one is the last body line, so end is i which is 1-based equivalent of i-1? — we want inclusive last line of body)
    }
    return lines.length;
  };

  // Build ranges for classes and defs. Process in order so we can assign
  // className to methods whose def sits inside a class's range.
  interface BlockRange extends BlockStart { endLine: number }
  const ranges: BlockRange[] = starts.map((s, idx) => ({
    ...s,
    endLine: resolveEnd(idx, s.indent),
  }));

  // Mark methods: a def whose own indent > some class's indent AND whose
  // startLine is within that class's [startLine, endLine] AND that class
  // is the nearest (smallest) enclosing class.
  for (const r of ranges) {
    if (r.kind !== 'function') continue;
    let bestClass: BlockRange | undefined;
    for (const c of ranges) {
      if (c.kind !== 'class') continue;
      if (r.indent <= c.indent) continue;
      if (r.startLine <= c.startLine) continue;
      if (r.startLine > c.endLine) continue;
      if (!bestClass || c.indent > bestClass.indent) bestClass = c;
    }
    if (bestClass) {
      r.kind = 'method';
      r.className = bestClass.name;
    }
  }

  for (const r of ranges) {
    if (r.kind === 'class') continue;
    defs.push({
      name: r.name,
      file,
      startLine: r.startLine,
      endLine: r.endLine,
      signature: signatureAt(source, r.startLine),
      kind: r.kind === 'method' ? 'method' : 'function',
      ...(r.className ? { className: r.className } : {}),
      language: LANG,
    });
  }

  // ── Pass 2: find call sites, attribute to innermost enclosing def ───
  const enclosingFor = (line1: number): string => {
    let best: FunctionDef | null = null;
    for (const d of defs) {
      if (line1 >= d.startLine && line1 <= d.endLine) {
        if (!best || (d.endLine - d.startLine) < (best.endLine - best.startLine)) {
          best = d;
        }
      }
    }
    return best ? (best.className ? `${best.className}.${best.name}` : best.name) : '<top>';
  };

  // bare-name calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = new RegExp(CALL_RE.source, CALL_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name)) continue;
      // Skip if this line is itself a def/class declaring that name.
      const defMatch = line.match(DEF_RE);
      if (defMatch && defMatch[2] === name) continue;
      const classMatch = line.match(CLASS_RE);
      if (classMatch && classMatch[2] === name) continue;
      calls.push({
        callerName: enclosingFor(i + 1),
        callerFile: file,
        callerLine: i + 1,
        calleeName: name,
        language: LANG,
      });
    }
  }

  // method calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = new RegExp(METHOD_CALL_RE.source, METHOD_CALL_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name)) continue;
      calls.push({
        callerName: enclosingFor(i + 1),
        callerFile: file,
        callerLine: i + 1,
        calleeName: name,
        language: LANG,
      });
    }
  }

  // Silence unused variable from array strip helper.
  void origLines;

  return { defs, calls };
}
