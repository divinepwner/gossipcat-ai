const BASE = '/dashboard/api';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: 'include',
    ...options,
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function login(key: string): Promise<boolean> {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  return res.ok;
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/overview`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}
