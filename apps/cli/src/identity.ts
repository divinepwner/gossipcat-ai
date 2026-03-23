import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';

function getOrCreateSalt(projectRoot: string): string {
  const saltPath = join(projectRoot, '.gossip', 'local-salt');
  if (existsSync(saltPath)) return readFileSync(saltPath, 'utf-8').trim();
  const salt = randomBytes(16).toString('hex');
  mkdirSync(join(projectRoot, '.gossip'), { recursive: true });
  writeFileSync(saltPath, salt);
  return salt;
}

export function getUserId(projectRoot: string): string {
  try {
    const email = execFileSync('git', ['config', 'user.email'], { stdio: 'pipe' }).toString().trim();
    const salt = getOrCreateSalt(projectRoot);
    return createHash('sha256').update(email + projectRoot + salt).digest('hex').slice(0, 16);
  } catch { return 'anonymous'; }
}

export function getProjectId(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
}
