/**
 * Bridge between MCP server and the orchestrator's skill loader.
 * Loads agent config from gossip.agents.json, resolves skills.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

export function loadSkills(agentId: string, projectRoot: string): string {
  // Get agent's skills from config
  const configPath = resolve(projectRoot, 'gossip.agents.json');
  if (!existsSync(configPath)) return '';

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const agentConfig = config.agents?.[agentId];
  if (!agentConfig?.skills?.length) return '';

  const sections: string[] = [];
  for (const skill of agentConfig.skills) {
    const content = resolveSkill(agentId, skill, projectRoot);
    if (content) sections.push(content);
  }

  return sections.length > 0
    ? '\n\n--- SKILLS ---\n\n' + sections.join('\n\n---\n\n') + '\n\n--- END SKILLS ---\n\n'
    : '';
}

function resolveSkill(agentId: string, skill: string, projectRoot: string): string | null {
  const filename = `${skill}.md`;
  // Normalize underscores to hyphens for file lookup
  const filenameHyphen = `${skill.replace(/_/g, '-')}.md`;

  const candidates = [
    resolve(projectRoot, '.gossip', 'agents', agentId, 'skills', filename),
    resolve(projectRoot, '.gossip', 'agents', agentId, 'skills', filenameHyphen),
    resolve(projectRoot, '.gossip', 'skills', filename),
    resolve(projectRoot, '.gossip', 'skills', filenameHyphen),
    resolve(projectRoot, 'packages', 'orchestrator', 'src', 'default-skills', filename),
    resolve(projectRoot, 'packages', 'orchestrator', 'src', 'default-skills', filenameHyphen),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, 'utf-8');
  }
  return null;
}
