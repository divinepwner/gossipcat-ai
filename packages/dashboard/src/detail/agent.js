// packages/dashboard/src/detail/agent.js — Agent detail view

async function renderAgentDetail(app, agentId) {
  const { api, escapeHtml: e, formatTokens, agentInitials, navigate, makeSection } = window._dash;
  app.innerHTML = '<div class="loading">Loading agent...</div>';

  try {
    const [agents, memData] = await Promise.all([api('agents'), api('memory/' + encodeURIComponent(agentId))]);
    const agent = agents.find(a => a.id === agentId);
    if (!agent) { app.innerHTML = '<div class="empty-state">Agent not found: ' + e(agentId) + '</div>'; return; }

    const s = agent.scores || {};
    app.innerHTML = '';

    // Trust ring header
    const w = s.dispatchWeight ?? 1;
    const signals = s.signals ?? 0;
    const accuracy = s.accuracy ?? 0.5;
    const ringColor = signals === 0 ? 'var(--text-3)'
      : w >= 1.5 ? 'var(--green)'
      : w >= 0.8 ? 'var(--amber)'
      : 'var(--red)';
    const ringOpacity = signals === 0 ? '0.35' : '1';
    const arcLength = 132 * Math.min(1, accuracy);

    const header = document.createElement('div');
    header.className = 'detail-header';
    header.innerHTML =
      '<div class="ag-ring-wrap" style="width:56px;height:56px;flex-shrink:0">' +
        '<svg class="ag-ring" viewBox="0 0 48 48" style="width:56px;height:56px;opacity:' + ringOpacity + '">' +
          '<circle cx="24" cy="24" r="21" fill="none" stroke="' + ringColor + '" stroke-width="3" opacity="0.2"/>' +
          '<circle cx="24" cy="24" r="21" fill="none" stroke="' + ringColor + '" stroke-width="3"' +
            ' stroke-dasharray="' + arcLength + ' 132" transform="rotate(-90 24 24)"/>' +
        '</svg>' +
        '<span class="ag-initials" style="color:' + ringColor + ';font-size:16px">' + agentInitials(agentId) + '</span>' +
      '</div>' +
      '<div style="flex:1">' +
        '<div class="detail-title">' + e(agentId) + '</div>' +
        '<div class="detail-subtitle">' + e(agent.provider || '') + ' &middot; ' + e(agent.model || '') + (agent.preset ? ' &middot; ' + e(agent.preset) : '') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:20px;text-align:right">' +
        '<div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--accent)">' + Math.round(accuracy * 100) + '%</div><div style="font-size:11px;color:var(--text-3)">Accuracy</div></div>' +
        '<div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--blue)">' + Math.round((s.uniqueness || 0) * 100) + '%</div><div style="font-size:11px;color:var(--text-3)">Unique</div></div>' +
        '<div><div style="font-family:var(--mono);font-size:18px;font-weight:600">' + (signals || 0) + '</div><div style="font-size:11px;color:var(--text-3)">Signals</div></div>' +
        '<div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--green)">' + formatTokens(agent.totalTokens) + '</div><div style="font-size:11px;color:var(--text-3)">Tokens</div></div>' +
        '<div><div style="font-family:var(--mono);font-size:18px;font-weight:600">' + w.toFixed(2) + '</div><div style="font-size:11px;color:var(--text-3)">Weight</div></div>' +
      '</div>';
    app.appendChild(header);

    // Memory section
    if (memData.knowledge && memData.knowledge.length > 0) {
      const memSection = makeSection('Knowledge', memData.fileCount + ' files');
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = '<div class="panel-head"><span class="panel-title">Knowledge Files</span></div>';
      const body = document.createElement('div');
      body.className = 'panel-body';
      for (const k of [...memData.knowledge].reverse().slice(0, 20)) {
        const isCognitive = (k.frontmatter && k.frontmatter.type === 'cognitive') || (k.content || '').includes('You reviewed');
        const desc = e((k.frontmatter && (k.frontmatter.description || k.frontmatter.name)) || k.filename);
        const row = document.createElement('div');
        row.className = 'memory-file' + (isCognitive ? ' cognitive' : '');
        row.innerHTML =
          '<div class="memory-file-header" onclick="this.nextElementSibling.hidden=!this.nextElementSibling.hidden">' +
          '<span style="font-family:monospace;color:var(--text-3);width:1rem;text-align:center">+</span>' +
          '<span class="memory-filename">' + e(k.filename) + '</span>' +
          '<span class="memory-desc">' + desc + '</span></div>' +
          '<pre class="memory-file-content" hidden>' + e(k.content) + '</pre>';
        body.appendChild(row);
      }
      panel.appendChild(body);
      memSection.appendChild(panel);
      app.appendChild(memSection);
    }

  } catch (err) {
    app.innerHTML = '<div class="empty-state">Failed to load agent: ' + e(err.message) + '</div>';
  }
}
