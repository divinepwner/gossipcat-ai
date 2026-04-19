/**
 * Language-agnostic extractor contract.
 *
 * Every language-specific extractor implements this shape so the index
 * builder can treat files uniformly. Types (`FunctionDef`, `CallSite`)
 * live here so they are stable across languages — a Python def and a
 * TypeScript function produce records the query layer can compare.
 *
 * Not on this contract: comment/string stripping, scope resolution,
 * signature formatting. Those are language-specific implementation
 * details that live in each extractor file.
 */

/** A function/method/arrow definition discovered in source. */
export interface FunctionDef {
  /** Bare symbol name. For methods, the unqualified method name. */
  name: string;
  /** Absolute file path. */
  file: string;
  /** 1-based line where the definition opens. */
  startLine: number;
  /**
   * 1-based line where the definition body ends. Best-effort:
   *  - brace-delimited languages (TS/JS, Go, Rust, Java, C) use the
   *    matching close-brace line
   *  - indentation-delimited languages (Python) use the last line at
   *    or below the opening indent
   *  - when the end cannot be located (truncated file, malformed
   *    source) this equals `startLine` to avoid spurious ranges
   */
  endLine: number;
  /** Single-line declaration text — no body, trimmed. Max 240 chars. */
  signature: string;
  kind: 'function' | 'method' | 'arrow';
  /** For methods: the enclosing class / impl / receiver-type when statically determinable. */
  className?: string;
  /** Source language the extractor identified this from. */
  language: Language;
}

/** A call site discovered in source. */
export interface CallSite {
  /** Best-effort enclosing function/method name; "<top>" at module scope. */
  callerName: string;
  callerFile: string;
  /** 1-based line. */
  callerLine: number;
  /** Bare callee name. For `obj.foo()` the value is `foo`. */
  calleeName: string;
  language: Language;
}

export interface ExtractResult {
  defs: FunctionDef[];
  calls: CallSite[];
}

/**
 * Supported source languages. Add new members as extractors land — the
 * public API surface (`XrefIndex`, tool names) does not change per
 * language; only the dispatch in `xref/index.ts` gains a new case.
 */
export type Language = 'typescript' | 'python' | 'go' | 'rust';

/**
 * Extractor — a pure function from (file path, source) to an
 * `ExtractResult`. Extractors MUST be side-effect-free and MUST NOT
 * depend on which other extractors have been run. Language-specific
 * quirks (Python indent scope, Rust nested comments, Go receivers) live
 * inside the individual extractor files.
 */
export type Extractor = (file: string, source: string) => ExtractResult;
