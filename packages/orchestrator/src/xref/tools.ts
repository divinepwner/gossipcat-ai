/**
 * Verifier tool definitions for the xref index. Surfaces three queries
 * (callers_of, calls_of, defined_at) so a cross-review LLM can ask the AST
 * "is this symbol called from where the finding claims?" instead of
 * grepping. Tools are pure-function over an `XrefIndex`; no side effects,
 * no I/O.
 *
 * The tool names use underscores (`xref_callers_of`) so they match the
 * existing verifier convention (`file_read`, `file_grep`). Routing happens
 * by name prefix in consensus-engine; see `runXrefTool` below.
 */

import type { ToolDefinition } from '@gossip/types';
import type { XrefIndex } from './query';

export const XREF_TOOL_NAMES = {
  callersOf: 'xref_callers_of',
  callsOf: 'xref_calls_of',
  definedAt: 'xref_defined_at',
} as const;

export const XREF_TOOLS: ToolDefinition[] = [
  {
    name: XREF_TOOL_NAMES.callersOf,
    description:
      'List call sites where the named symbol is invoked. Returns {file, line, callerName} entries. Use to verify findings that claim "X is never called" or "X is called from Y".',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Bare symbol name (no parens, no dot path). For methods, the unqualified method name.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: XREF_TOOL_NAMES.callsOf,
    description:
      'List the call sites that appear inside any definition of the named symbol. Use to verify findings about what a function does — "foo() calls bar()" is checkable here.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Bare symbol name of the enclosing function/method.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: XREF_TOOL_NAMES.definedAt,
    description:
      'Return the file, line range, and signature of every definition of the named symbol. Use to verify findings that reference a function — does it exist, where, with what signature.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Bare symbol name.',
        },
      },
      required: ['symbol'],
    },
  },
];

/** True when the tool name is one this module handles. */
export function isXrefTool(name: string): boolean {
  return (
    name === XREF_TOOL_NAMES.callersOf ||
    name === XREF_TOOL_NAMES.callsOf ||
    name === XREF_TOOL_NAMES.definedAt
  );
}

/**
 * Execute an xref tool call and return a stringified JSON result suitable
 * for the verifier tool-result message. Unknown tool name returns an error
 * payload — never throws (the verifier loop already wraps thrown errors,
 * but staying total here keeps stack traces out of LLM context).
 */
export function runXrefTool(
  index: XrefIndex,
  name: string,
  args: Record<string, unknown>,
): string {
  const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
  if (!symbol) {
    return JSON.stringify({ error: `${name}: missing or empty 'symbol' argument` });
  }

  switch (name) {
    case XREF_TOOL_NAMES.callersOf: {
      const sites = index.callersOf(symbol);
      return JSON.stringify({
        symbol,
        callers: sites.map(s => ({
          file: s.callerFile,
          line: s.callerLine,
          callerName: s.callerName,
        })),
        count: sites.length,
      });
    }
    case XREF_TOOL_NAMES.callsOf: {
      const sites = index.callsOf(symbol);
      return JSON.stringify({
        symbol,
        calls: sites.map(s => ({
          file: s.callerFile,
          line: s.callerLine,
          calleeName: s.calleeName,
        })),
        count: sites.length,
      });
    }
    case XREF_TOOL_NAMES.definedAt: {
      const defs = index.definedAt(symbol);
      return JSON.stringify({
        symbol,
        definitions: defs.map(d => ({
          file: d.file,
          startLine: d.startLine,
          endLine: d.endLine,
          signature: d.signature,
          kind: d.kind,
          ...(d.className ? { className: d.className } : {}),
        })),
        count: defs.length,
      });
    }
    default:
      return JSON.stringify({ error: `unknown xref tool: ${name}` });
  }
}
