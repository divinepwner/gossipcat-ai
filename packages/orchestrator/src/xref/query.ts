/**
 * Xref query layer — read-only views over an aggregated `ExtractResult`.
 *
 * The index is built once per dispatch (or per file set) and queried many
 * times by the verifier inside the cross-review tool loop. All accessors
 * return plain JSON-serializable arrays so they can be passed straight back
 * as a tool response with no further marshaling.
 */

import type { CallSite, FunctionDef } from './ts-extractor';

export interface XrefIndex {
  /** Symbol → all call sites where the symbol is the callee. */
  callersOf(symbol: string): CallSite[];
  /**
   * Symbol → call sites that appear inside any definition of that symbol.
   * "What does foo() call?" — flattened across overloads.
   */
  callsOf(symbol: string): CallSite[];
  /** Symbol → all definition records (functions, methods, arrows). */
  definedAt(symbol: string): FunctionDef[];
  size(): { defs: number; calls: number; files: number };
}

export interface IndexInput {
  defs: FunctionDef[];
  calls: CallSite[];
}

/**
 * Build an index from one or more `ExtractResult` payloads. The output is
 * frozen-equivalent at the API surface — accessors return fresh arrays
 * sliced from internal maps, so callers can mutate the results without
 * corrupting the index.
 */
export function buildXrefIndex(input: IndexInput): XrefIndex {
  const defsByName = new Map<string, FunctionDef[]>();
  const callsByCallee = new Map<string, CallSite[]>();
  const defsByFile = new Map<string, FunctionDef[]>();

  for (const d of input.defs) {
    let arr = defsByName.get(d.name);
    if (!arr) { arr = []; defsByName.set(d.name, arr); }
    arr.push(d);

    let fileArr = defsByFile.get(d.file);
    if (!fileArr) { fileArr = []; defsByFile.set(d.file, fileArr); }
    fileArr.push(d);
  }

  for (const c of input.calls) {
    let arr = callsByCallee.get(c.calleeName);
    if (!arr) { arr = []; callsByCallee.set(c.calleeName, arr); }
    arr.push(c);
  }

  const filesSet = new Set<string>();
  for (const d of input.defs) filesSet.add(d.file);
  for (const c of input.calls) filesSet.add(c.callerFile);

  return {
    callersOf(symbol: string): CallSite[] {
      return (callsByCallee.get(symbol) ?? []).slice();
    },

    callsOf(symbol: string): CallSite[] {
      const out: CallSite[] = [];
      const defs = defsByName.get(symbol) ?? [];
      for (const def of defs) {
        const fileCalls = input.calls.filter(c =>
          c.callerFile === def.file &&
          c.callerLine >= def.startLine &&
          c.callerLine <= def.endLine,
        );
        for (const c of fileCalls) out.push(c);
      }
      return out;
    },

    definedAt(symbol: string): FunctionDef[] {
      return (defsByName.get(symbol) ?? []).slice();
    },

    size() {
      return {
        defs: input.defs.length,
        calls: input.calls.length,
        files: filesSet.size,
      };
    },
  };
}
