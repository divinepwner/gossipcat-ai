// packages/dashboard/src/app.js

// ── API Helper ──────────────────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(`/dashboard/api/${path}`, { credentials: 'include' });
  if (res.status === 401) {
    throw new Error('Unauthorized');
  }
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────────
const authGate = document.getElementById('auth-gate');
const dashboard = document.getElementById('dashboard');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');

function showAuth() {
  authGate.hidden = false;
  dashboard.hidden = true;
  // Close WebSocket if open
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

function showDashboard() {
  authGate.hidden = true;
  dashboard.hidden = false;
  connectWs();
  loadTab('overview');
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = document.getElementById('auth-key').value.trim();
  try {
    const res = await fetch('/dashboard/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      credentials: 'include',
    });
    if (!res.ok) {
      authError.hidden = false;
      return;
    }
    // Verify the cookie was actually set by making an authenticated call
    const verify = await fetch('/dashboard/api/overview', { credentials: 'include' });
    if (verify.ok) {
      authError.hidden = true;
      showDashboard();
    } else {
      authError.hidden = false;
    }
  } catch {
    authError.hidden = false;
  }
});

// ── Tab Routing ──────────────────────────────────────────────────────────────
const tabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    loadTab(tab.dataset.tab);
  });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
let ws = null;
const wsStatus = document.getElementById('ws-status');
const wsLabel = document.getElementById('ws-label');
const eventListeners = [];

function onDashboardEvent(fn) { eventListeners.push(fn); }

function connectWs() {
  if (ws) return; // already connected
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/dashboard/ws`);

  ws.onopen = () => {
    wsStatus.className = 'status-dot online';
    wsLabel.textContent = 'Connected';
  };

  ws.onclose = () => {
    wsStatus.className = 'status-dot offline';
    wsLabel.textContent = 'Disconnected';
    ws = null;
    // Only reconnect if dashboard is visible (not on auth gate)
    if (!dashboard.hidden) {
      setTimeout(connectWs, 3000);
    }
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      for (const fn of eventListeners) fn(event);
    } catch { /* ignore */ }
  };
}

// ── Tab Loading ──────────────────────────────────────────────────────────────
async function loadTab(name) {
  switch (name) {
    case 'overview': return renderOverview();
    case 'agents': return renderAgents();
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
// Check if already authenticated (valid cookie from previous session)
api('overview').then(() => showDashboard()).catch(() => showAuth());

// Make helpers available to tab modules
window._dash = { api, onDashboardEvent };
