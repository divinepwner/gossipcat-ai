import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

export interface CatalogEntry {
  name: string;
  description: string;
  keywords: string[];
  categories: string[];
}

interface CatalogData {
  version: number;
  skills: CatalogEntry[];
}

export class SkillCatalog {
  private entries: CatalogEntry[];
  private readonly skillsDir: string;

  constructor(catalogPath?: string) {
    const defaultPath = resolve(__dirname, 'default-skills', 'catalog.json');
    const raw = readFileSync(catalogPath || defaultPath, 'utf-8');
    const data: CatalogData = JSON.parse(raw);
    this.entries = data.skills;
    this.skillsDir = resolve(__dirname, 'default-skills');
  }

  listSkills(): CatalogEntry[] {
    return [...this.entries];
  }

  matchTask(taskText: string): CatalogEntry[] {
    const lower = taskText.toLowerCase();
    return this.entries.filter(entry =>
      entry.keywords.some(kw => lower.includes(kw.toLowerCase()))
    );
  }

  checkCoverage(agentSkills: string[], taskText: string): string[] {
    const matched = this.matchTask(taskText);
    const warnings: string[] = [];
    for (const entry of matched) {
      if (!agentSkills.includes(entry.name)) {
        warnings.push(
          `Skill '${entry.name}' (${entry.description}) may be relevant but is not assigned to this agent. ` +
          `Add it to the agent's skills in gossip.agents.json.`
        );
      }
    }
    return warnings;
  }

  validate(): string[] {
    const issues: string[] = [];
    const mdFiles = readdirSync(this.skillsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', '').replace(/-/g, '_'));

    for (const file of mdFiles) {
      if (!this.entries.find(e => e.name === file)) {
        issues.push(`Skill file '${file}' has no catalog entry`);
      }
    }
    return issues;
  }
}
