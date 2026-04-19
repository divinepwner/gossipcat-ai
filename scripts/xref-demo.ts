/**
 * Ad-hoc xref demo — index the orchestrator source and print what the
 * verifier would see for a handful of symbols. Run with:
 *   npx ts-node -r tsconfig-paths/register -P tsconfig.json scripts/xref-demo.ts <symbol>
 * or no argument to use the default list.
 */
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  buildXrefIndexFromFiles,
  runXrefTool,
  XREF_TOOL_NAMES,
  isSupportedXrefFile,
} from '@gossip/orchestrator';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-mcp' || entry === 'dist-dashboard' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (isSupportedXrefFile(p)) out.push(p);
  }
  return out;
}

const root = process.cwd();
const files = walk(join(root, 'packages'))
  .concat(walk(join(root, 'apps')));

process.stderr.write(`Indexing ${files.length} files...\n`);
const start = Date.now();
const { index, errors } = buildXrefIndexFromFiles(files);
const elapsed = Date.now() - start;
const sz = index.size();
process.stderr.write(
  `Index built in ${elapsed}ms — ${sz.defs} defs, ${sz.calls} calls, ${sz.files} files, ${errors.length} errors\n\n`,
);

const DEFAULTS = [
  'buildCacheableSystem',
  'markToolsCacheable',
  'extractFromSource',
  'extractFromPython',
  'runXrefTool',
  'crossReviewForAgent',
];

const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS;

for (const symbol of symbols) {
  console.log('═'.repeat(74));
  console.log(`  ${symbol}`);
  console.log('═'.repeat(74));

  const defPayload = JSON.parse(runXrefTool(index, XREF_TOOL_NAMES.definedAt, { symbol }));
  if (defPayload.count === 0) {
    console.log('  (no definition found)\n');
    continue;
  }
  console.log(`\n  DEFINED AT (${defPayload.count}):`);
  for (const d of defPayload.definitions) {
    const where = `${d.file.replace(root + '/', '')}:${d.startLine}-${d.endLine}`;
    const cls = d.className ? ` [${d.className}]` : '';
    console.log(`    • ${where} ${d.kind}${cls}`);
    console.log(`      ${d.signature.slice(0, 100)}`);
  }

  const callersPayload = JSON.parse(runXrefTool(index, XREF_TOOL_NAMES.callersOf, { symbol }));
  console.log(`\n  CALLED FROM (${callersPayload.count}):`);
  for (const c of callersPayload.callers.slice(0, 15)) {
    console.log(`    • ${c.file.replace(root + '/', '')}:${c.line}  in  ${c.callerName}`);
  }
  if (callersPayload.count > 15) console.log(`    … and ${callersPayload.count - 15} more`);

  const callsPayload = JSON.parse(runXrefTool(index, XREF_TOOL_NAMES.callsOf, { symbol }));
  console.log(`\n  INTERNALLY CALLS (${callsPayload.count}):`);
  const uniqueCallees = new Map<string, number>();
  for (const c of callsPayload.calls) {
    uniqueCallees.set(c.calleeName, (uniqueCallees.get(c.calleeName) ?? 0) + 1);
  }
  const sorted = [...uniqueCallees.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted.slice(0, 15)) {
    console.log(`    • ${name}${count > 1 ? ` ×${count}` : ''}`);
  }
  if (sorted.length > 15) console.log(`    … and ${sorted.length - 15} more distinct names`);
  console.log('');
}
