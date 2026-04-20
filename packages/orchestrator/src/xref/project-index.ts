/**
 * Project-wide xref index builder — walks a project root, collects all
 * supported source files, and produces a single `XrefIndex` cached by
 * root path.
 *
 * Used by `ConsensusEngine` to auto-populate an xref index whenever a
 * `projectRoot` is configured. Set `GOSSIP_DISABLE_XREF=1` in the env to
 * opt out (e.g. for memory-constrained environments or when the index is
 * provided externally).
 *
 * Safety caps — never walk further than these:
 *   - MAX_FILES   5000 source files
 *   - MAX_BYTES   50 MB total source size
 * Both caps cause the walk to stop early and mark `truncated: true`. A
 * partial index is still usable — verifier results are evidence, not
 * ground truth.
 *
 * Cache is per-process, keyed by absolute root path. Subsequent calls
 * for the same root return the cached result; `force: true` rebuilds.
 * File-mtime-based invalidation is deferred to the persistent-cache
 * follow-up in docs/specs/2026-04-19-ast-xref-and-context-compaction.md.
 */

import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { buildXrefIndexFromFiles, isSupportedXrefFile } from './index';
import type { XrefIndex } from './query';

export const MAX_FILES = 5000;
export const MAX_TOTAL_BYTES = 50_000_000;

/** Directories we never descend into. */
export const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'dist-mcp', 'dist-dashboard',
  'build', 'out', '.next', 'coverage',
  '.git', '.gossip', '.claude', '.agents',
  '.superpowers', '.gstack', '.full-review',
  'target', 'vendor', '__pycache__', '.venv', 'venv',
]);

export interface ProjectIndexResult {
  index: XrefIndex;
  fileCount: number;
  defCount: number;
  callCount: number;
  elapsedMs: number;
  errorCount: number;
  /** True when the walk stopped early due to MAX_FILES or MAX_TOTAL_BYTES. */
  truncated: boolean;
  /** Absolute project root the result was built from. */
  projectRoot: string;
}

const cache = new Map<string, ProjectIndexResult>();

export interface BuildOptions {
  /** If true, bypass the cache and re-walk. */
  force?: boolean;
}

/**
 * Build (or retrieve from cache) an xref index covering all supported
 * source files under `projectRoot`. Safe to call repeatedly — subsequent
 * calls hit the cache unless `force: true`.
 */
export function buildProjectXrefIndex(
  projectRoot: string,
  opts: BuildOptions = {},
): ProjectIndexResult {
  const absRoot = resolve(projectRoot);
  if (!opts.force) {
    const cached = cache.get(absRoot);
    if (cached) return cached;
  }

  const start = Date.now();
  const files: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  const walk = (dir: string): void => {
    if (truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (IGNORE_DIRS.has(entry)) continue;
      if (entry.startsWith('.') && entry !== '.github' && entry !== '.claude-code') continue;
      const p = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (isSupportedXrefFile(p)) {
        if (files.length >= MAX_FILES) { truncated = true; return; }
        if (totalBytes + st.size > MAX_TOTAL_BYTES) { truncated = true; return; }
        totalBytes += st.size;
        files.push(p);
      }
    }
  };

  walk(absRoot);

  const { index, errors } = buildXrefIndexFromFiles(files);
  const sz = index.size();
  const result: ProjectIndexResult = {
    index,
    fileCount: sz.files,
    defCount: sz.defs,
    callCount: sz.calls,
    elapsedMs: Date.now() - start,
    errorCount: errors.length,
    truncated,
    projectRoot: absRoot,
  };
  cache.set(absRoot, result);
  return result;
}

/**
 * Clear cached index(es). With no argument, drops every entry. Useful for
 * tests and for callers that know a large external change has happened
 * (git checkout, branch switch).
 */
export function clearProjectXrefCache(projectRoot?: string): void {
  if (projectRoot) {
    cache.delete(resolve(projectRoot));
  } else {
    cache.clear();
  }
}

/** Testing / diagnostics: current cache size. */
export function projectXrefCacheSize(): number {
  return cache.size;
}
