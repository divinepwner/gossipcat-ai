/**
 * Xref module — symbol/call cross-reference for the consensus verifier.
 *
 * Public façade. Dispatches file-level extraction to the right language
 * extractor based on file extension, then aggregates into a single
 * `XrefIndex`.
 *
 * Supported languages: TypeScript/JavaScript, Python, Go, Rust. Adding a
 * new language is two steps: implement `Extractor` in a new file under
 * this directory, add its extensions to `EXTRACTOR_BY_EXT` below.
 *
 * Spec: docs/specs/2026-04-19-ast-xref-and-context-compaction.md §Phase 1.
 */

import { readFileSync } from 'fs';
import { extractFromSource } from './ts-extractor';
import { extractFromPython } from './python-extractor';
import { extractFromGo } from './go-extractor';
import { extractFromRust } from './rust-extractor';
import { buildXrefIndex } from './query';
import type { XrefIndex } from './query';
import type { Extractor, Language } from './types';

export type { FunctionDef, CallSite, ExtractResult, Language, Extractor } from './types';
export { extractFromSource, stripCommentsAndStrings } from './ts-extractor';
export { extractFromPython, stripPythonCommentsAndStrings } from './python-extractor';
export { extractFromGo, stripGoCommentsAndStrings } from './go-extractor';
export { extractFromRust, stripRustCommentsAndStrings } from './rust-extractor';
export { buildXrefIndex } from './query';
export type { XrefIndex, IndexInput } from './query';
export {
  XREF_TOOLS,
  XREF_TOOL_NAMES,
  isXrefTool,
  runXrefTool,
} from './tools';
export {
  buildProjectXrefIndex,
  clearProjectXrefCache,
  projectXrefCacheSize,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  IGNORE_DIRS,
} from './project-index';
export type { ProjectIndexResult, BuildOptions } from './project-index';

/**
 * File-extension → extractor dispatch. Keys are lowercase, include the
 * leading dot. Add new languages here after their extractor lands.
 */
const EXTRACTOR_BY_EXT: Record<string, Extractor> = {
  '.ts': extractFromSource,
  '.tsx': extractFromSource,
  '.js': extractFromSource,
  '.jsx': extractFromSource,
  '.mjs': extractFromSource,
  '.cjs': extractFromSource,
  '.py': extractFromPython,
  '.pyi': extractFromPython,
  '.go': extractFromGo,
  '.rs': extractFromRust,
};

const LANG_BY_EXT: Record<string, Language> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'typescript', '.jsx': 'typescript',
  '.mjs': 'typescript', '.cjs': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

/** Pick the extractor for a file path, or undefined if unsupported. */
export function extractorFor(path: string): Extractor | undefined {
  const lower = path.toLowerCase();
  for (const ext of Object.keys(EXTRACTOR_BY_EXT)) {
    if (lower.endsWith(ext)) return EXTRACTOR_BY_EXT[ext];
  }
  return undefined;
}

/** Pick the language label for a file path, or undefined if unsupported. */
export function languageOf(path: string): Language | undefined {
  const lower = path.toLowerCase();
  for (const ext of Object.keys(LANG_BY_EXT)) {
    if (lower.endsWith(ext)) return LANG_BY_EXT[ext];
  }
  return undefined;
}

export function isSupportedXrefFile(path: string): boolean {
  return extractorFor(path) !== undefined;
}

/**
 * Build an index by reading and extracting a list of absolute file paths.
 * Files that cannot be read or that throw during extraction are skipped
 * with their paths returned in `errors` — the index never aborts on a
 * single bad file.
 */
export function buildXrefIndexFromFiles(files: string[]): {
  index: XrefIndex;
  errors: Array<{ file: string; error: string }>;
} {
  const allDefs = [];
  const allCalls = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const extract = extractorFor(file);
    if (!extract) continue;
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch (e) {
      errors.push({ file, error: `read failed: ${(e as Error).message}` });
      continue;
    }
    try {
      const r = extract(file, source);
      allDefs.push(...r.defs);
      allCalls.push(...r.calls);
    } catch (e) {
      errors.push({ file, error: `extract failed: ${(e as Error).message}` });
    }
  }

  return {
    index: buildXrefIndex({ defs: allDefs, calls: allCalls }),
    errors,
  };
}
