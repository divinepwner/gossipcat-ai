import { DashboardRouter } from '@gossip/relay/dashboard/routes';
import { DashboardAuth } from '@gossip/relay/dashboard/auth';
import { IncomingMessage, ServerResponse } from 'http';
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';

function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function mockRes(): ServerResponse & { _status: number; _headers: Record<string, string>; _body: string } {
  const res = new EventEmitter() as any;
  res._status = 200;
  res._headers = {};
  res._body = '';
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res._status = code;
    if (headers) Object.assign(res._headers, headers);
    return res;
  };
  res.setHeader = (k: string, v: string) => { res._headers[k] = v; };
  res.end = (body?: string) => { res._body = body ?? ''; };
  return res;
}

describe('DashboardRouter', () => {
  let projectRoot: string;
  let auth: DashboardAuth;
  let router: DashboardRouter;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'gossip-dash-'));
    mkdirSync(join(projectRoot, '.gossip'), { recursive: true });
    auth = new DashboardAuth(projectRoot);
    auth.init();
    router = new DashboardRouter(auth, projectRoot, { agentConfigs: [], relayConnections: 0 });
  });

  it('returns 404 for non-dashboard routes', async () => {
    const req = mockReq('GET', '/other');
    const res = mockRes();
    const handled = await router.handle(req, res);
    expect(handled).toBe(false);
  });

  it('POST /dashboard/api/auth sets session cookie on valid key', async () => {
    const req = mockReq('POST', '/dashboard/api/auth');
    const body = JSON.stringify({ key: auth.getKey() });
    const res = mockRes();

    // Simulate body
    const handled = router.handle(req, res);
    req.emit('data', Buffer.from(body));
    req.emit('end');
    await handled;

    expect(res._status).toBe(200);
    expect(res._headers['Set-Cookie']).toContain('dashboard_session=');
    expect(res._headers['Set-Cookie']).toContain('HttpOnly');
    expect(res._headers['Set-Cookie']).toContain('SameSite=Strict');
  });

  it('POST /dashboard/api/auth rejects invalid key', async () => {
    const req = mockReq('POST', '/dashboard/api/auth');
    const body = JSON.stringify({ key: 'wrong' });
    const res = mockRes();

    const handled = router.handle(req, res);
    req.emit('data', Buffer.from(body));
    req.emit('end');
    await handled;

    expect(res._status).toBe(401);
  });

  it('API routes require valid session', async () => {
    const req = mockReq('GET', '/dashboard/api/overview');
    const res = mockRes();
    await router.handle(req, res);
    expect(res._status).toBe(401);
  });

  it('API routes work with valid session cookie', async () => {
    const token = auth.createSession(auth.getKey())!;
    const req = mockReq('GET', '/dashboard/api/overview', {
      cookie: `dashboard_session=${token}`,
    });
    const res = mockRes();
    await router.handle(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body).toHaveProperty('agentsOnline');
  });
});
