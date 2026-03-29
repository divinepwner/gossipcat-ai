// packages/dashboard/src/tabs/agents.js

async function renderAgents() {
  const container = document.getElementById('tab-agents');
  container.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const agents = await window._dash.api('agents');

    if (agents.length === 0) {
      container.innerHTML = '<div class="empty-state">No agents configured. Run gossip_setup to create your team.</div>';
      return;
    }

    container.innerHTML = `<div class="agent-cards">${agents.map(renderAgentCard).join('')}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
  }
}

function renderAgentCard(agent) {
  const s = agent.scores;
  return `
    <div class="agent-detail-card">
      <div class="agent-header">
        <div>
          <strong>${agent.id}</strong>
          ${agent.native ? '<span class="agent-badge">native</span>' : ''}
          <div class="agent-meta">${agent.provider} / ${agent.model}${agent.preset ? ` (${agent.preset})` : ''}</div>
        </div>
        <div class="weight-badge" style="font-size:1.25rem">${s.dispatchWeight.toFixed(2)}</div>
      </div>

      <div class="agent-stats">
        <div class="agent-stat">
          <div class="num" style="color:var(--accent-primary)">${(s.accuracy * 100).toFixed(0)}%</div>
          <div class="lbl">Accuracy</div>
        </div>
        <div class="agent-stat">
          <div class="num" style="color:var(--accent-secondary)">${(s.uniqueness * 100).toFixed(0)}%</div>
          <div class="lbl">Uniqueness</div>
        </div>
        <div class="agent-stat">
          <div class="num" style="color:var(--status-confirmed)">${(s.reliability * 100).toFixed(0)}%</div>
          <div class="lbl">Reliability</div>
        </div>
        <div class="agent-stat">
          <div class="num">${s.signals}</div>
          <div class="lbl">Signals</div>
        </div>
        <div class="agent-stat">
          <div class="num">${s.agreements}</div>
          <div class="lbl">Agrees</div>
        </div>
        <div class="agent-stat">
          <div class="num">${s.disagreements}</div>
          <div class="lbl">Disagrees</div>
        </div>
        <div class="agent-stat">
          <div class="num" style="color:var(--status-disputed)">${s.hallucinations}</div>
          <div class="lbl">Hallucinations</div>
        </div>
      </div>

      ${agent.skills.length > 0 ? `
        <div style="margin-top:1rem">
          <div class="panel-title" style="margin-bottom:0.5rem">Skills</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.375rem">
            ${agent.skills.map(sk => `<span class="agent-badge">${sk}</span>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
