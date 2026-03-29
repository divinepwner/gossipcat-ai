import { IncomingMessage, ServerResponse } from 'http';
import { DashboardAuth } from './auth';
import { overviewHandler } from './api-overview';
import { agentsHandler } from './api-agents';
import { skillsGetHandler, skillsBindHandler } from './api-skills';
import { memoryHandler } from './api-memory';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AgentConfigLike {
  id: string;
  provider: string;
  model: string;
  preset?: string;
  skills: string[];
  native?: boolean;
}

interface DashboardContext {
  agentConfigs: AgentConfigLike[];
  relayConnections: number;
}

export class DashboardRouter {
  constructor(
    private auth: DashboardAuth,
    private projectRoot: string,
    private ctx: DashboardContext,
  ) {}

  /** Update live context (call when agents connect/disconnect) */
  updateContext(ctx: Partial<DashboardContext>): void {
    if (ctx.agentConfigs !== undefined) this.ctx.agentConfigs = ctx.agentConfigs;
    if (ctx.relayConnections !== undefined) this.ctx.relayConnections = ctx.relayConnections;
  }

  /**
   * Handle an HTTP request. Returns true if the route was handled, false otherwise.
   * Caller should only call this for URLs starting with /dashboard.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '';
    if (!url.startsWith('/dashboard')) return false;

    // Auth endpoint — no session required
    if (url === '/dashboard/api/auth' && req.method === 'POST') {
      return this.handleAuth(req, res);
    }

    // Serve static dashboard (SPA)
    if (url === '/dashboard' || url === '/dashboard/') {
      return this.serveDashboard(res);
    }

    // All other /dashboard/api/* routes require session
    if (url.startsWith('/dashboard/api/')) {
      const token = this.extractSessionToken(req);
      if (!token || !this.auth.validateSession(token)) {
        this.json(res, 401, { error: 'Unauthorized' });
        return true;
      }
      return this.handleApi(req, res, url);
    }

    // Static assets
    if (url.startsWith('/dashboard/assets/')) {
      return this.serveAsset(res, url);
    }

    this.json(res, 404, { error: 'Not found' });
    return true;
  }

  private async handleAuth(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const body = await readBody(req);
    try {
      const { key } = JSON.parse(body);
      const token = this.auth.createSession(key);
      if (!token) {
        this.json(res, 401, { error: 'Invalid key' });
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `dashboard_session=${token}; HttpOnly; SameSite=Strict; Path=/dashboard; Max-Age=86400`,
      });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      this.json(res, 400, { error: 'Invalid request body' });
    }
    return true;
  }

  private async handleApi(req: IncomingMessage, res: ServerResponse, url: string): Promise<boolean> {
    try {
      if (url === '/dashboard/api/overview' && req.method === 'GET') {
        const data = await overviewHandler(this.projectRoot, this.ctx);
        this.json(res, 200, data);
        return true;
      }

      if (url === '/dashboard/api/agents' && req.method === 'GET') {
        const data = await agentsHandler(this.projectRoot, this.ctx.agentConfigs);
        this.json(res, 200, data);
        return true;
      }

      if (url === '/dashboard/api/skills' && req.method === 'GET') {
        const data = await skillsGetHandler(this.projectRoot);
        this.json(res, 200, data);
        return true;
      }

      if (url === '/dashboard/api/skills/bind' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const data = await skillsBindHandler(this.projectRoot, body);
        this.json(res, data.success ? 200 : 400, data);
        return true;
      }

      // Memory: /dashboard/api/memory/:agentId
      const memoryMatch = url.match(/^\/dashboard\/api\/memory\/([^/]+)$/);
      if (memoryMatch && req.method === 'GET') {
        try {
          const data = await memoryHandler(this.projectRoot, memoryMatch[1]);
          this.json(res, 200, data);
        } catch (err) {
          this.json(res, 400, { error: err instanceof Error ? err.message : 'Bad request' });
        }
        return true;
      }

      this.json(res, 404, { error: 'Unknown API endpoint' });
    } catch (err) {
      this.json(res, 500, { error: 'Internal server error' });
    }
    return true;
  }

  private serveDashboard(res: ServerResponse): boolean {
    const htmlPath = join(this.projectRoot, 'dist-dashboard', 'index.html');
    if (!existsSync(htmlPath)) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Dashboard not built. Run: npm run build:dashboard');
      return true;
    }
    const html = readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }

  private serveAsset(res: ServerResponse, _url: string): boolean {
    // No assets in Phase 1 — everything is bundled in index.html
    res.writeHead(404);
    res.end();
    return true;
  }

  private extractSessionToken(req: IncomingMessage): string | null {
    const cookie = req.headers.cookie;
    if (!cookie) return null;
    const match = cookie.match(/dashboard_session=([^;]+)/);
    return match ? match[1] : null;
  }

  private json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

const MAX_BODY_SIZE = 8 * 1024; // 8 KB — ample for auth key and skill bind payloads

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
