import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

export interface SearchResult {
  source: string;
  name: string;
  description: string;
  score: number;
  snippets: string[];
}

interface ParsedFrontmatter {
  name: string;
  description: string;
  importance: number;
}

export class MemorySearcher {
  constructor(private projectRoot: string) {}

  search(agentId: string, query: string, maxResults = 3): SearchResult[] {
    if (!query || !query.trim()) return [];

    const limit = Math.min(maxResults, 10);
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return [];

    const memDir = join(this.projectRoot, '.gossip', 'agents', agentId, 'memory');
    if (!existsSync(memDir)) return [];

    const results: SearchResult[] = [];

    // Search knowledge .md files
    const knowledgeDir = join(memDir, 'knowledge');
    if (existsSync(knowledgeDir)) {
      const files = readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = join(knowledgeDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const frontmatter = this.parseFrontmatter(content);
        const body = content.replace(/^---[\s\S]*?---\n*/, '');

        const name = frontmatter?.name || basename(file, '.md');
        const description = frontmatter?.description || '';
        const importance = frontmatter?.importance ?? 0.5;

        const score = this.scoreContent(keywords, name, description, body, importance);
        if (score > 0) {
          results.push({
            source: file,
            name,
            description,
            score,
            snippets: this.extractSnippets(body, keywords),
          });
        }
      }
    }

    // Search tasks.jsonl
    const tasksPath = join(memDir, 'tasks.jsonl');
    if (existsSync(tasksPath)) {
      const lines = readFileSync(tasksPath, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { taskId?: string; task?: string; skills?: string[] };
          const taskText = entry.task || '';
          const skillsText = (entry.skills || []).join(' ');
          const combined = `${taskText} ${skillsText}`;
          const score = this.scoreTaskEntry(keywords, taskText, skillsText);
          if (score > 0) {
            results.push({
              source: 'tasks.jsonl',
              name: entry.taskId || 'task',
              description: taskText.slice(0, 120),
              score,
              snippets: this.extractSnippets(combined, keywords),
            });
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private extractKeywords(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9]/g, '');
      if (clean.length > 3 && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
    return result;
  }

  private scoreContent(
    keywords: string[],
    name: string,
    description: string,
    body: string,
    importance: number,
  ): number {
    const nameLower = name.toLowerCase();
    const descLower = description.toLowerCase();
    const bodyLower = body.toLowerCase();

    let score = 0;
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 3;
      if (descLower.includes(kw)) score += 2;
      // body match capped at 5 per keyword
      let bodyCount = 0;
      let idx = 0;
      while (bodyCount < 5 && (idx = bodyLower.indexOf(kw, idx)) !== -1) {
        bodyCount++;
        score += 1;
        idx += kw.length;
      }
    }

    return score > 0 ? score * importance : 0;
  }

  private scoreTaskEntry(keywords: string[], task: string, skills: string): number {
    const taskLower = task.toLowerCase();
    const skillsLower = skills.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (taskLower.includes(kw)) score += 3;
      if (skillsLower.includes(kw)) score += 2;
    }
    return score;
  }

  private extractSnippets(body: string, keywords: string[]): string[] {
    const lines = body.split('\n');
    const bodyLower = body.toLowerCase();
    const snippets: string[] = [];
    const seen = new Set<number>();

    for (const kw of keywords) {
      let idx = 0;
      while (snippets.length < 3 && (idx = bodyLower.indexOf(kw, idx)) !== -1) {
        // Find line index for this position
        const before = body.slice(0, idx);
        const lineIdx = before.split('\n').length - 1;
        if (!seen.has(lineIdx)) {
          const line = lines[lineIdx]?.trim();
          if (line && line.length > 0) {
            seen.add(lineIdx);
            snippets.push(line);
          }
        }
        idx += kw.length;
        if (snippets.length >= 3) break;
      }
      if (snippets.length >= 3) break;
    }

    return snippets;
  }

  private parseFrontmatter(content: string): ParsedFrontmatter | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const lines = match[1].split('\n');
    const obj: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      obj[key] = value;
    }
    return {
      name: obj.name || '',
      description: obj.description || '',
      importance: parseFloat(obj.importance) || 0.5,
    };
  }
}
