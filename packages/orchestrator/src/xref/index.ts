/**
 * Xref module — symbol/call cross-reference for the consensus verifier.
 *
 * Public façade. Compose the pieces into a single `buildXrefIndexFromFiles`
 * helper for the common path: read files from disk, extract, build index.
 *
 * Spec: docs/specs/2026-04-19-ast-xref-and-context-compaction.md §Phase 1.
 */

import { readFileSync } from 'fs';
import { extractFromSource } from './ts-extractor';
import { buildXrefIndex } from './query';
import type { XrefIndex } from './query';

export type { FunctionDef, CallSite, ExtractResult } from './ts-extractor';
export { extractFromSource, stripCommentsAndStrings } from './ts-extractor';
export { buildXrefIndex } from './query';
export type { XrefIndex, IndexInput } from './query';
export {
  XREF_TOOLS,
  XREF_TOOL_NAMES,
  isXrefTool,
  runXrefTool,
} from './tools';

/** File extensions handled by the TS/JS extractor. */
const SUPPORTED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function isSupportedXrefFile(path: string): boolean {
  return SUPPORTED_EXTS.some(ext => path.toLowerCase().endsWith(ext));
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
    if (!isSupportedXrefFile(file)) continue;
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch (e) {
      errors.push({ file, error: `read failed: ${(e as Error).message}` });
      continue;
    }
    try {
      const r = extractFromSource(file, source);
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
