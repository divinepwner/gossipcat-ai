// packages/dashboard/src/detail/consensus.js — Single consensus run detail

async function renderConsensusDetail(app, taskId) {
  const { api, escapeHtml: e, makeSection } = window._dash;
  app.innerHTML = '<div class="loading">Loading consensus run...</div>';

  try {
    const data = await api('consensus');
    const run = (data.runs || []).find(r => r.taskId === taskId);
    if (!run) { app.innerHTML = '<div class="empty-state">Consensus run not found: ' + e(taskId) + '</div>'; return; }

    app.innerHTML = '';
    const section = makeSection('Consensus Run', run.agents.length + ' agents');

    // Summary pills
    const c = run.counts || {};
    const pills = document.createElement('div');
    pills.style.cssText = 'display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap';
    const pillDefs = [
      { label: 'agreements', value: c.agreement || 0, cls: 'pill-g' },
      { label: 'disagreements', value: c.disagreement || 0, cls: 'pill-r' },
      { label: 'hallucinations', value: c.hallucination || 0, cls: 'pill-r' },
      { label: 'unverified', value: c.unverified || 0, cls: 'pill-y' },
      { label: 'unique', value: c.unique || 0, cls: 'pill-b' },
    ];
    for (const p of pillDefs) {
      const pill = document.createElement('span');
      pill.className = 'pill ' + p.cls;
      pill.textContent = p.value + ' ' + p.label;
      pills.appendChild(pill);
    }
    section.appendChild(pills);

    // Finding rows
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<div class="panel-head"><span class="panel-title">Signals</span></div>';
    const body = document.createElement('div');
    body.className = 'panel-body run-findings';
    body.style.maxHeight = '500px';

    for (const s of (run.signals || [])) {
      const signal = s.signal || '';
      let tc = 'tag-b';
      if (signal.includes('agreement')) tc = 'tag-g';
      else if (signal.includes('hallucination') || signal.includes('disagree')) tc = 'tag-r';
      else if (signal.includes('unverified')) tc = 'tag-y';

      const typeLabel = signal.replace(/_/g, ' ').replace(/caught$/, '').trim().toUpperCase();
      const agentPart = e(s.agentId || '');
      const counterPart = s.counterpartId ? ' → ' + e(s.counterpartId) : '';
      const evidence = e((s.evidence || '').slice(0, 200));

      const row = document.createElement('div');
      row.className = 'finding-row';
      row.innerHTML =
        '<span class="finding-tag ' + tc + '">' + e(typeLabel) + '</span>' +
        '<div class="finding-body">' +
          '<div class="finding-text">' + evidence + '</div>' +
          '<div class="finding-attr">' + agentPart + counterPart + '</div>' +
        '</div>';
      body.appendChild(row);
    }

    panel.appendChild(body);
    section.appendChild(panel);
    app.appendChild(section);
  } catch (err) {
    app.innerHTML = '<div class="empty-state">Failed to load consensus: ' + e(err.message) + '</div>';
  }
}
