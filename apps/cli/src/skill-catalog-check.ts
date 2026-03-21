// apps/cli/src/skill-catalog-check.ts
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

interface CatalogEntry {
  name: string;
  keywords: string[];
  description: string;
}

interface CatalogData {
  skills: CatalogEntry[];
}

/**
 * Lightweight keyword-match for the low-level dispatch path.
 * Scans task text for catalog keywords and warns if the assigned agent
 * doesn't have the matching skill.
 */
export function checkSkillCoverage(
  agentId: string,
  agentSkills: string[],
  taskText: string,
  projectRoot: string
): string[] {
  const catalogPaths = [
    resolve(projectRoot, 'node_modules', '@gossip', 'orchestrator', 'dist', 'default-skills', 'catalog.json'),
    resolve(projectRoot, 'packages', 'orchestrator', 'src', 'default-skills', 'catalog.json'),
  ];

  let catalog: CatalogData | null = null;
  for (const p of catalogPaths) {
    if (existsSync(p)) {
      catalog = JSON.parse(readFileSync(p, 'utf-8'));
      break;
    }
  }
  if (!catalog) return [];

  const lower = taskText.toLowerCase();
  const warnings: string[] = [];

  for (const entry of catalog.skills) {
    const matched = entry.keywords.some(kw => lower.includes(kw.toLowerCase()));
    if (matched && !agentSkills.includes(entry.name)) {
      warnings.push(
        `Agent '${agentId}' may need skill '${entry.name}' (${entry.description}) for this task.`
      );
    }
  }

  return warnings;
}
