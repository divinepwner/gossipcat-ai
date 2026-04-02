import { randomBytes, timingSafeEqual, createHash } from 'crypto';

const KEY_LENGTH = 16; // 16 bytes = 32 hex chars
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 50;

interface Session {
  token: string;
  expiresAt: number;
}

export class DashboardAuth {
  private key: string = '';
  private sessions: Map<string, Session> = new Map();

  init(): void {
    this.key = randomBytes(KEY_LENGTH).toString('hex');
    this.sessions.clear();
  }

  regenerateKey(): void {
    this.key = randomBytes(KEY_LENGTH).toString('hex');
    this.sessions.clear();
  }

  getKey(): string {
    return this.key;
  }

  /** Returns first 8 chars for display in CLI boot message */
  getKeyPrefix(): string {
    return this.key.slice(0, 8);
  }

  createSession(candidateKey: string): string | null {
    if (!candidateKey || typeof candidateKey !== 'string') return null;
    // Hash both to fixed length — avoids timing oracle from length comparison
    const a = createHash('sha256').update(candidateKey).digest();
    const b = createHash('sha256').update(this.key).digest();
    if (!timingSafeEqual(a, b)) return null;

    // Evict expired sessions before creating new one
    const now = Date.now();
    for (const [t, s] of this.sessions) {
      if (now > s.expiresAt) this.sessions.delete(t);
    }
    // Cap active sessions
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { token, expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  validateSession(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }
}
