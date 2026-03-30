// packages/dashboard/src/detail/signals.js — Full signal feed with type/agent filters

async function renderSignalsDetail(app) {
  const { api, escapeHtml: e, makeSection, timeAgo } = window._dash;
  app.innerHTML = '<div class="loading">Loading signals...</div>';

  try {
    const data = await api('signals');
    app.innerHTML = '';

    const section = makeSection('Signals', data.total + ' total');

    // Type filters
    const filters = document.createElement('div');
    filters.className = 'filters';
    const types = ['all', 'agreement', 'disagreement', 'unique', 'hallucination'];
    let activeType = 'all';

    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + (t === 'all' ? ' active' : '');
      btn.textContent = t === 'hallucination' ? 'halluc.' : t;
      btn.addEventListener('click', () => {
        activeType = t;
        filters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRows();
      });
      filters.appendChild(btn);
    }
    section.appendChild(filters);

    const list = document.createElement('div');
    list.className = 'run-list';
    section.appendChild(list);

    function tagClass(signal) {
      if ((signal || '').includes('agreement')) return 'tag-g';
      if ((signal || '').includes('hallucination')) return 'tag-r';
      if ((signal || '').includes('disagree')) return 'tag-r';
      if ((signal || '').includes('unique')) return 'tag-b';
      return 'tag-b';
    }

    function renderRows() {
      list.innerHTML = '';
      const filtered = (data.signals || []).filter(s => {
        if (activeType === 'all') return true;
        return (s.signal || '').includes(activeType);
      });

      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">No matching signals</div>';
        return;
      }

      const panel = document.createElement('div');
      panel.className = 'panel';
      const body = document.createElement('div');
      body.className = 'panel-body run-findings';
      body.style.maxHeight = '600px';

      for (const s of filtered) {
        const typeLabel = (s.signal || '').replace(/_/g, ' ').replace(/caught$/, '').trim().toUpperCase();
        const tc = tagClass(s.signal);
        const finding = e((s.evidence || s.finding || '').slice(0, 160));
        const agentPart = e(s.agentId || '');
        const counterPart = s.counterpartId ? ' → ' + e(s.counterpartId) : '';
        const time = s.timestamp ? timeAgo(s.timestamp) : '';
        const attrText = agentPart + counterPart + (time ? ' · ' + time : '');

        const row = document.createElement('div');
        row.className = 'finding-row';
        row.innerHTML =
          '<span class="finding-tag ' + tc + '">' + e(typeLabel) + '</span>' +
          '<div class="finding-body">' +
            '<div class="finding-text">' + finding + '</div>' +
            '<div class="finding-attr">' + attrText + '</div>' +
          '</div>';
        body.appendChild(row);
      }

      panel.appendChild(body);
      list.appendChild(panel);
    }

    renderRows();
    app.appendChild(section);
  } catch (err) {
    app.innerHTML = '<div class="empty-state">Failed to load signals: ' + err.message + '</div>';
  }
}
