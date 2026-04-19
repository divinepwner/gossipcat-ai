/**
 * TypeScript / JavaScript symbol extractor — conforms to the shared
 * `Extractor` contract in `./types.ts`.
 *
 * Scope (Phase 1 MVP):
 *   - Function/method/arrow definitions with line ranges
 *   - Call sites with the call name (best-effort)
 *
 * Implementation: regex over a comment- and string-stripped source. NOT an
 * AST. False positives are possible (dynamic dispatch, computed property
 * names, JSX-as-tag) and surface as `confidence: 'low'` on the resulting
 * tool response. Verifier consumers should treat results as evidence to
 * cross-check, not as ground truth — the same posture the rest of the
 * consensus pipeline already takes for citations.
 *
 * See docs/specs/2026-04-19-ast-xref-and-context-compaction.md §Phase 1.
 */

import type { CallSite, ExtractResult, FunctionDef } from './types';

const LANG = 'typescript' as const;

/** A function/method/arrow definition discovered in source. */
export type { FunctionDef, CallSite, ExtractResult } from './types';

// Word-boundary anchored so m.index points at the keyword/name itself.
// Earlier `(?:^|\s)` variants consumed the preceding whitespace, which made
// startLine off by one when the declaration sat after a newline.
const FUNCTION_DECL_RE = /\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/;
const ARROW_DECL_RE = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
const CLASS_DECL_RE = /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const METHOD_DECL_RE = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\s*\{/;
/** Reserved words and statement keywords that look like calls but are not. */
const NON_CALL_KEYWORDS = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'in', 'of', 'new', 'await', 'yield', 'throw', 'delete', 'void', 'function',
  'super', 'this',
]);
const CALL_RE = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
const METHOD_CALL_RE = /\.([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Strip block comments, line comments, and string/template literals from a
 * source string. Preserves line counts so any line numbers computed against
 * the result map back to the original. String contents are replaced with
 * spaces of the same length so brace/paren counting still works.
 *
 * Limitations:
 *  - Regex literals are not specially handled; uncommon inside identifier
 *    contexts but possible. Treat as best-effort.
 *  - JSX is not parsed; `<Foo>` may leak through as if it were a comparison.
 *    Acceptable for verifier-grade lookups.
 */
export function stripCommentsAndStrings(source: string): string {
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
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
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
        if (ch === quote) {
          out.push(' ');
          i++;
          break;
        }
        out.push(ch === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

/**
 * Locate the line of the matching closing brace for an opening brace on
 * `startLine` (1-based). Returns `startLine` when the brace cannot be paired
 * (truncated input, malformed source). Counts braces on the cleaned source
 * so braces inside strings/comments are ignored.
 */
function findClosingBrace(cleaned: string, openOffset: number): number {
  let depth = 0;
  let started = false;
  for (let i = openOffset; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') {
      depth++;
      started = true;
    } else if (c === '}') {
      depth--;
      if (started && depth === 0) return i;
    }
  }
  return -1;
}

function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Extract function definitions and call sites from a single source file.
 * Pure: no I/O, no globals; safe to call concurrently.
 */
export function extractFromSource(file: string, source: string): ExtractResult {
  const cleaned = stripCommentsAndStrings(source);
  const defs: FunctionDef[] = [];
  const calls: CallSite[] = [];

  // ── Definitions ──────────────────────────────────────────────────────
  // Class scope tracking: when we encounter `class Foo {`, anything inside
  // (until matching close brace) is treated as Foo's body for method naming.
  const classes: Array<{ name: string; openOffset: number; closeOffset: number }> = [];
  {
    const re = new RegExp(CLASS_DECL_RE.source, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const openIdx = cleaned.indexOf('{', m.index);
      if (openIdx === -1) continue;
      const closeIdx = findClosingBrace(cleaned, openIdx);
      if (closeIdx === -1) continue;
      classes.push({ name: m[1], openOffset: openIdx, closeOffset: closeIdx });
    }
  }

  // function declarations
  {
    const re = new RegExp(FUNCTION_DECL_RE.source, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const startLine = offsetToLine(cleaned, m.index);
      const openIdx = cleaned.indexOf('{', m.index);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      defs.push({
        name: m[1], file, startLine, endLine,
        signature: signatureLineFromOriginal(source, startLine),
        kind: 'function',
        language: LANG,
      });
    }
  }

  // arrow function variable declarations
  {
    const re = new RegExp(ARROW_DECL_RE.source, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const startLine = offsetToLine(cleaned, m.index);
      const openIdx = cleaned.indexOf('{', m.index);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      defs.push({
        name: m[1], file, startLine, endLine,
        signature: signatureLineFromOriginal(source, startLine),
        kind: 'arrow',
        language: LANG,
      });
    }
  }

  // method declarations — only inside a class scope, anchored to start-of-line
  for (const cls of classes) {
    const region = cleaned.slice(cls.openOffset, cls.closeOffset);
    const re = new RegExp(METHOD_DECL_RE.source, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(region)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name) || name === 'constructor') continue;
      const absOffset = cls.openOffset + m.index;
      const startLine = offsetToLine(cleaned, absOffset);
      const openIdx = cleaned.indexOf('{', absOffset);
      const closeIdx = openIdx === -1 ? -1 : findClosingBrace(cleaned, openIdx);
      const endLine = closeIdx === -1 ? startLine : offsetToLine(cleaned, closeIdx);
      defs.push({
        name, file, startLine, endLine,
        signature: signatureLineFromOriginal(source, startLine),
        kind: 'method',
        className: cls.name,
        language: LANG,
      });
    }
  }

  // ── Call sites ───────────────────────────────────────────────────────
  // For each call expression, find the enclosing definition by line range.
  // If multiple defs contain the line, pick the innermost (smallest range).
  const enclosingFor = (line: number): string => {
    let best: FunctionDef | null = null;
    for (const d of defs) {
      if (line >= d.startLine && line <= d.endLine) {
        if (!best || (d.endLine - d.startLine) < (best.endLine - best.startLine)) {
          best = d;
        }
      }
    }
    return best ? (best.className ? `${best.className}.${best.name}` : best.name) : '<top>';
  };

  // bare-name calls
  {
    const re = new RegExp(CALL_RE.source, CALL_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[1];
      if (NON_CALL_KEYWORDS.has(name)) continue;
      // Skip if this match is itself the declared name on its line (avoid
      // double-counting `function foo(` as a call to `foo`). Other names on
      // the same line as a declaration ARE legitimate calls — see
      // `function caller() { helper(); }` where `helper` must register.
      const matchOffset = m.index + m[0].indexOf(name);
      if (isOwnDeclarationName(cleaned, matchOffset, name)) continue;
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

  // method calls (`.foo(`)
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

/**
 * True when `name` is the symbol being declared at this offset's line.
 * Distinct from "is there any declaration on this line" — that check would
 * spuriously suppress legitimate calls that share a line with a function
 * head, e.g. `function caller() { helper(); }` where `helper` must register
 * even though the line also matches FUNCTION_DECL_RE.
 */
function isOwnDeclarationName(cleaned: string, offset: number, name: string): boolean {
  const lineStart = cleaned.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = cleaned.indexOf('\n', offset);
  const line = cleaned.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const fn = line.match(FUNCTION_DECL_RE);
  if (fn && fn[1] === name) return true;
  const arrow = line.match(ARROW_DECL_RE);
  if (arrow && arrow[1] === name) return true;
  const method = line.match(METHOD_DECL_RE);
  if (method && method[1] === name) return true;
  return false;
}

function signatureLineFromOriginal(source: string, line1: number): string {
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
