// packages/dashboard/src/tabs/overview.js

async function renderOverview() {
  const container = document.getElementById('tab-overview');
  container.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const [overview, agents] = await Promise.all([
      window._dash.api('overview'),
      window._dash.api('agents'),
    ]);

    container.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card">
          <div class="label">Agents Online</div>
          <div class="value">${overview.agentsOnline}</div>
          <div class="detail">${overview.relayCount} relay, ${overview.nativeCount} native</div>
        </div>
        <div class="stat-card">
          <div class="label">Consensus Runs</div>
          <div class="value">${overview.consensusRuns}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Findings</div>
          <div class="value">${overview.totalFindings}</div>
          <div class="detail">${overview.confirmedFindings} confirmed</div>
        </div>
        <div class="stat-card">
          <div class="label">Performance Signals</div>
          <div class="value">${overview.totalSignals}</div>
        </div>
      </div>

      <div class="panels">
        <div class="panel">
          <div class="panel-title">Agent Scores</div>
          <div id="agent-scores">
            ${agents.length === 0 ? '<div class="empty-state">No agents configured</div>' :
              agents
                .sort((a, b) => b.scores.dispatchWeight - a.scores.dispatchWeight)
                .map(a => `
                  <div class="agent-row">
                    <div class="agent-name">
                      ${a.id}
                      ${a.native ? '<span class="agent-badge">native</span>' : ''}
                    </div>
                    <div class="bar-group">
                      <div class="bar-label">acc</div>
                      <div class="bar-container"><div class="bar-fill accuracy" style="width:${(a.scores.accuracy * 100).toFixed(0)}%"></div></div>
                      <div class="bar-label">uniq</div>
                      <div class="bar-container"><div class="bar-fill uniqueness" style="width:${(a.scores.uniqueness * 100).toFixed(0)}%"></div></div>
                      <div class="bar-label">rel</div>
                      <div class="bar-container"><div class="bar-fill reliability" style="width:${(a.scores.reliability * 100).toFixed(0)}%"></div></div>
                    </div>
                    <div class="weight-badge">${a.scores.dispatchWeight.toFixed(2)}</div>
                  </div>
                `).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">Live Activity</div>
          <div id="activity-timeline" class="timeline">
            <div class="empty-state">Waiting for events...</div>
          </div>
        </div>
      </div>
    `;

    // Wire up live activity from WebSocket
    const timeline = document.getElementById('activity-timeline');
    let hasEvents = false;

    window._dash.onDashboardEvent((event) => {
      if (!hasEvents) {
        timeline.innerHTML = '';
        hasEvents = true;
      }

      const colors = {
        task_completed: 'green', consensus_complete: 'green',
        task_dispatched: 'purple', agent_connected: 'purple', agent_disconnected: 'purple',
        skill_changed: 'yellow', consensus_started: 'yellow',
        task_failed: 'red',
      };

      const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const color = colors[event.type] || 'purple';
      const text = formatEvent(event);

      const entry = document.createElement('div');
      entry.className = 'timeline-entry';
      entry.innerHTML = `
        <div class="timeline-dot ${color}"></div>
        <div class="timeline-time">${time}</div>
        <div class="timeline-text">${text}</div>
      `;
      timeline.prepend(entry);

      // Cap timeline entries
      while (timeline.children.length > 100) {
        timeline.removeChild(timeline.lastChild);
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
  }
}

function formatEvent(event) {
  const d = event.data || {};
  switch (event.type) {
    case 'task_dispatched': return `Task dispatched to <strong>${d.agentId || '?'}</strong>`;
    case 'task_completed': return `Task completed by <strong>${d.agentId || '?'}</strong>`;
    case 'task_failed': return `Task failed on <strong>${d.agentId || '?'}</strong>`;
    case 'consensus_started': return `Consensus started (${d.agentCount || '?'} agents)`;
    case 'consensus_complete': return `Consensus complete — ${d.confirmed || 0} confirmed`;
    case 'agent_connected': return `<strong>${d.agentId || '?'}</strong> connected`;
    case 'agent_disconnected': return `<strong>${d.agentId || '?'}</strong> disconnected`;
    case 'skill_changed': return `Skill <strong>${d.skill || '?'}</strong> toggled for ${d.agentId || '?'}`;
    default: return event.type;
  }
}
