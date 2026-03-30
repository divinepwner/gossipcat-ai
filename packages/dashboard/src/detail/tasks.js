// packages/dashboard/src/detail/tasks.js — Full task list with filters + search + tokens

async function renderTasksDetail(app) {
  const { api, escapeHtml: e, formatTokens, makeSection, timeAgo } = window._dash;
  app.innerHTML = '<div class="loading">Loading tasks...</div>';

  try {
    const data = await api('tasks');
    app.innerHTML = '';

    const section = makeSection('Tasks', data.total + ' total');

    // Filters
    const filters = document.createElement('div');
    filters.className = 'filters';
    const statuses = ['all', 'completed', 'failed', 'running', 'cancelled'];
    let activeFilter = 'all';

    for (const s of statuses) {
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + (s === 'all' ? ' active' : '');
      btn.textContent = s;
      btn.addEventListener('click', () => {
        activeFilter = s;
        filters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRows();
      });
      filters.appendChild(btn);
    }
    section.appendChild(filters);

    // Search
    const search = document.createElement('input');
    search.className = 'search-input';
    search.placeholder = 'Search by agent or task description...';
    search.addEventListener('input', renderRows);
    section.appendChild(search);

    // Table
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<div class="panel-body" style="max-height:500px"></div>';
    const body = panel.querySelector('.panel-body');
    section.appendChild(panel);

    function renderRows() {
      body.innerHTML = '';
      const q = search.value.toLowerCase();
      const filtered = (data.tasks || []).filter(t => {
        if (activeFilter !== 'all' && t.status !== activeFilter) return false;
        if (q && !t.agentId.toLowerCase().includes(q) && !(t.task || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (filtered.length === 0) {
        body.innerHTML = '<div class="empty-state">No matching tasks</div>';
        return;
      }

      for (const t of filtered) {
        const dotColor = t.status === 'completed' ? 'var(--green)'
          : t.status === 'failed' ? 'var(--red)'
          : t.status === 'cancelled' ? 'var(--amber)'
          : 'var(--accent)';
        const dur = t.duration > 0 ? (t.duration / 1000).toFixed(1) + 's' : '—';
        const tokens = (t.inputTokens || t.outputTokens) ? formatTokens((t.inputTokens || 0) + (t.outputTokens || 0)) : '—';
        const desc = e((t.task || '').replace(/\n.*/s, '').slice(0, 80));
        const time = t.timestamp ? timeAgo(t.timestamp) : '';

        const row = document.createElement('div');
        row.className = 'task-row';
        row.innerHTML =
          '<span class="task-dot" style="background:' + dotColor + '"></span>' +
          '<span class="task-agent">' + e(t.agentId) + '</span>' +
          '<span class="task-desc">' + desc + '</span>' +
          '<span class="task-meta">' + dur + '</span>' +
          '<span class="task-meta">' + tokens + '</span>' +
          '<span class="task-meta">' + time + '</span>';
        body.appendChild(row);
      }
    }

    renderRows();
    app.appendChild(section);
  } catch (err) {
    app.innerHTML = '<div class="empty-state">Failed to load tasks: ' + e(err.message) + '</div>';
  }
}
