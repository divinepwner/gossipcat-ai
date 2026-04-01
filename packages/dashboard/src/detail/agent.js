// packages/dashboard/src/detail/agent.js — Agent grid view (#/team and #/team/:id)

const AGENT_GRID = '48px 1fr 100px 90px 90px 90px 80px 100px';

// renderAgentDetail handles both #/team (agentId undefined) and #/team/:id
async function renderAgentDetail(app, agentId) {
  const { api, escapeHtml: e, agentInitials, formatTokens, makeSection, navigate } = window._dash;
  const { createDataView, createDataRow, createExpansionManager,
          createEmptyState, createErrorState, formatMetric } = window._dataRows;

  app.innerHTML = '<div class="loading">Loading agents...</div>';

  let agents;
  try {
    agents = await api('agents');
  } catch (err) {
    app.innerHTML = '';
    const section = makeSection('Team', '');
    section.appendChild(createErrorState(() => renderAgentDetail(app, agentId)));
    app.appendChild(section);
    return;
  }

  if (!agents || agents.length === 0) {
    app.innerHTML = '';
    const section = makeSection('Team', '0 agents');
    section.appendChild(createEmptyState('No agents configured.', null));
    app.appendChild(section);
    return;
  }

  // If #/team/:id and agent not found, show error
  if (agentId && !agents.find(a => a.id === agentId)) {
    app.innerHTML = '<div class="empty-state">Agent not found: ' + e(agentId) + '</div>';
    return;
  }

  app.innerHTML = '';
  const section = makeSection('Team', agents.length + ' agents');

  // Sort state
  let sortKey = 'weight';
  let sortDir = 'desc';

  const columns = [
    { key: 'ring',        label: '',            sortable: false },
    { key: 'name',        label: 'Agent',       sortable: false },
    { key: 'weight',      label: 'Weight',      sortable: true,  align: 'right' },
    { key: 'accuracy',    label: 'Accuracy',    sortable: true,  align: 'right' },
    { key: 'reliability', label: 'Reliability', sortable: true,  align: 'right' },
    { key: 'unique',      label: 'Unique',      sortable: true,  align: 'right' },
    { key: 'signals',     label: 'Signals',     sortable: true,  align: 'right' },
    { key: 'tokens',      label: 'Tokens',      sortable: true,  align: 'right' },
  ];

  const expansion = createExpansionManager();

  const dataView = createDataView({
    columns,
    gridTemplateColumns: AGENT_GRID,
    defaultSort: 'weight',
    defaultOrder: 'desc',
    onSort: (key, dir) => {
      sortKey = key;
      sortDir = dir;
      renderRows();
    },
  });

  section.appendChild(dataView);
  app.appendChild(section);

  // Track row elements by agent id for auto-scroll
  const rowMap = {};

  function getSorted() {
    const copy = [...agents];
    copy.sort((a, b) => {
      const s1 = a.scores || {};
      const s2 = b.scores || {};
      let v1, v2;
      if (sortKey === 'weight')      { v1 = s1.dispatchWeight ?? 0; v2 = s2.dispatchWeight ?? 0; }
      else if (sortKey === 'accuracy')    { v1 = s1.accuracy ?? 0;       v2 = s2.accuracy ?? 0; }
      else if (sortKey === 'reliability') { v1 = s1.reliability ?? 0;    v2 = s2.reliability ?? 0; }
      else if (sortKey === 'unique')      { v1 = s1.uniqueness ?? 0;     v2 = s2.uniqueness ?? 0; }
      else if (sortKey === 'signals')     { v1 = s1.signals ?? 0;        v2 = s2.signals ?? 0; }
      else if (sortKey === 'tokens')      { v1 = a.totalTokens ?? 0;     v2 = b.totalTokens ?? 0; }
      else { v1 = 0; v2 = 0; }
      return sortDir === 'asc' ? v1 - v2 : v2 - v1;
    });
    return copy;
  }

  function makeRingCell(agent) {
    const s = agent.scores || {};
    const w = s.dispatchWeight ?? 1;
    const signals = s.signals ?? 0;
    const accuracy = s.accuracy ?? 0.5;
    const ringColor = signals === 0 ? 'var(--text-3)'
      : w >= 1.5 ? 'var(--green)'
      : w >= 0.8 ? 'var(--amber)'
      : 'var(--red)';
    const ringOpacity = signals === 0 ? '0.35' : '1';
    const arcLength = 132 * Math.min(1, accuracy);
    const initials = agentInitials(agent.id);

    return (
      '<div style="position:relative;width:32px;height:32px;flex-shrink:0">' +
        '<svg viewBox="0 0 48 48" style="width:32px;height:32px;opacity:' + ringOpacity + '">' +
          '<circle cx="24" cy="24" r="21" fill="none" stroke="' + ringColor + '" stroke-width="3" opacity="0.2"/>' +
          '<circle cx="24" cy="24" r="21" fill="none" stroke="' + ringColor + '" stroke-width="3"' +
            ' stroke-dasharray="' + arcLength + ' 132" transform="rotate(-90 24 24)"/>' +
        '</svg>' +
        '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
          'font-size:10px;font-weight:700;font-family:var(--mono);color:' + ringColor + '">' +
          e(initials) +
        '</span>' +
      '</div>'
    );
  }

  function makeWeightCell(agent) {
    const w = (agent.scores || {}).dispatchWeight ?? 1;
    const barWidth = Math.round(Math.min(w / 2.5, 1) * 60);
    return (
      '<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">' +
        '<span class="data-bar" style="width:' + barWidth + 'px"></span>' +
        '<span style="font-family:var(--mono);font-size:12px">' + w.toFixed(2) + '</span>' +
      '</div>'
    );
  }

  function makeExpandPanel(agent, gridCols) {
    const s = agent.scores || {};
    const expand = document.createElement('div');
    expand.className = 'data-expand';

    // Skills block
    const slots = agent.skillSlots || [];
    if (slots.length > 0) {
      const skillBlock = document.createElement('div');
      skillBlock.className = 'expand-block';

      let pillsHtml = '<div class="expand-label">Skills</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px">';
      for (const slot of slots) {
        const enabled = slot.enabled !== false;
        const pillClass = enabled ? 'pill pill-g' : 'pill';
        const style = enabled ? '' : ' style="opacity:0.45;color:var(--text-3);background:var(--surface-raised)"';
        const name = e(slot.skillId || slot.name || '(unnamed)');
        pillsHtml += '<span class="' + pillClass + '"' + style + '>' + name + '</span>';
      }
      pillsHtml += '</div>';

      skillBlock.innerHTML = pillsHtml;
      expand.appendChild(skillBlock);
    }

    // Signal breakdown stacked bar
    const agreements = s.agreements ?? 0;
    const hallucinations = s.hallucinations ?? 0;
    const disagreements = s.disagreements ?? 0;
    const signals = s.signals ?? 0;
    const other = Math.max(0, signals - agreements - hallucinations - disagreements);

    if (signals > 0) {
      const sigBlock = document.createElement('div');
      sigBlock.className = 'expand-block';

      const pct = (n) => (n / signals * 100).toFixed(1) + '%';
      sigBlock.innerHTML =
        '<div class="expand-label">Signal Breakdown</div>' +
        '<div class="run-bar" style="height:8px;margin-top:6px">' +
          (agreements   > 0 ? '<div class="bar-seg bar-seg-g" style="flex:' + agreements   + '" title="Agreements: ' + agreements + '"></div>' : '') +
          (hallucinations > 0 ? '<div class="bar-seg bar-seg-r" style="flex:' + hallucinations + '" title="Hallucinations: ' + hallucinations + '"></div>' : '') +
          (disagreements > 0 ? '<div class="bar-seg bar-seg-y" style="flex:' + disagreements + '" title="Disagreements: ' + disagreements + '"></div>' : '') +
          (other         > 0 ? '<div class="bar-seg bar-seg-b" style="flex:' + other         + '" title="Other: ' + other + '"></div>' : '') +
        '</div>' +
        '<div class="expand-meta" style="margin-top:6px;font-size:11px;color:var(--text-3);font-family:var(--mono);display:flex;gap:12px">' +
          (agreements   > 0 ? '<span style="color:var(--green)">' + agreements + ' agree (' + pct(agreements) + ')</span>' : '') +
          (hallucinations > 0 ? '<span style="color:var(--red)">' + hallucinations + ' halluc. (' + pct(hallucinations) + ')</span>' : '') +
          (disagreements > 0 ? '<span style="color:var(--amber)">' + disagreements + ' disagree (' + pct(disagreements) + ')</span>' : '') +
        '</div>';
      expand.appendChild(sigBlock);
    }

    // Provider info
    const infoBlock = document.createElement('div');
    infoBlock.className = 'expand-block expand-meta-row';
    let infoHtml = '';
    if (agent.provider) {
      infoHtml += '<span class="expand-id">Provider: ' + e(agent.provider) + '</span>';
    }
    if (agent.model) {
      infoHtml += ' <span class="expand-id">Model: ' + e(agent.model) + '</span>';
    }
    if (agent.preset) {
      infoHtml += ' <span class="expand-id">Preset: ' + e(agent.preset) + '</span>';
    }
    infoHtml += ' <a href="#/knowledge/' + encodeURIComponent(agent.id) + '" class="expand-link">View memory</a>';
    infoBlock.innerHTML = infoHtml;
    expand.appendChild(infoBlock);

    return expand;
  }

  function renderRows() {
    const rows = dataView._dataView;
    rows.clear();
    rows.setLoadMoreVisible(false);

    const sorted = getSorted();

    if (sorted.length === 0) {
      rows.rows.appendChild(createEmptyState('No agents configured.', null));
      return;
    }

    for (const agent of sorted) {
      const s = agent.scores || {};
      const w = s.dispatchWeight ?? 1;
      const accuracy = s.accuracy ?? 0;
      const reliability = s.reliability ?? 0;
      const uniqueness = s.uniqueness ?? 0;
      const signals = s.signals ?? 0;
      const tokens = agent.totalTokens ?? 0;

      const cells = [
        { content: makeRingCell(agent), className: 'data-cell--center' },
        {
          content:
            '<div style="line-height:1.3">' +
            '<div style="font-weight:600;color:var(--text)">' + e(agent.id) + '</div>' +
            '<div style="font-size:11px;color:var(--text-3);font-family:var(--mono)">' +
              e(agent.provider || '') +
              (agent.model ? ' / ' + e(agent.model) : '') +
            '</div>' +
            '</div>',
        },
        { content: makeWeightCell(agent), className: 'data-cell--right' },
        { content: Math.round(accuracy * 100) + '%',    className: 'data-cell--right data-cell--mono' },
        { content: Math.round(reliability * 100) + '%', className: 'data-cell--right data-cell--mono' },
        { content: Math.round(uniqueness * 100) + '%',  className: 'data-cell--right data-cell--mono' },
        { content: String(signals),                      className: 'data-cell--right data-cell--mono' },
        { content: formatMetric(tokens),                 className: 'data-cell--right data-cell--mono' },
      ];

      const row = createDataRow(cells, (rowEl) => {
        const isExpanded = rowEl.classList.contains('data-row--expanded');

        expansion.expand(rowEl);

        if (isExpanded) {
          rowEl.classList.remove('data-row--expanded');
          const panel = rowEl.nextElementSibling;
          if (panel && panel.classList.contains('data-expand')) panel.remove();
          return;
        }

        rowEl.classList.add('data-row--expanded');
        const expand = makeExpandPanel(agent, AGENT_GRID);
        rowEl.insertAdjacentElement('afterend', expand);
      }, AGENT_GRID);

      rowMap[agent.id] = row;
      rows.rows.appendChild(row);
    }

    // Auto-scroll and expand when agentId param is set
    if (agentId && rowMap[agentId]) {
      const targetRow = rowMap[agentId];
      requestAnimationFrame(() => {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!targetRow.classList.contains('data-row--expanded')) {
          targetRow.click();
        }
      });
    }
  }

  renderRows();
}
