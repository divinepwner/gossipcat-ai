// packages/dashboard/src/detail/tasks.js — Full task list with grid layout, filters, search, pagination

const TASKS_GRID = '32px 120px 1fr 80px 80px 70px 80px';
const TASKS_PAGE_SIZE = 50;

function inferProvider(agentId) {
  return (agentId || '').toLowerCase().includes('gemini') ? 'google' : 'anthropic';
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s / 60) + 'm' + Math.round(s % 60) + 's';
}

function statusDot(status) {
  const color = status === 'completed' ? 'var(--green)'
    : status === 'failed' ? 'var(--red)'
    : status === 'cancelled' ? 'var(--amber)'
    : status === 'running' ? 'var(--accent)'
    : 'var(--text-3)';
  return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>';
}

function dateGroupLabel(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  if (d >= todayStart) return 'Today';
  if (d >= yesterdayStart) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

async function renderTasksDetail(app) {
  const { api, escapeHtml: e, timeAgo, makeSection } = window._dash;
  const { createDataView, createDataRow, createDateGroup, createExpansionManager,
          createEmptyState, createErrorState, formatMetric, estimateCost } = window._dataRows;

  app.innerHTML = '<div class="loading">Loading tasks...</div>';

  let allItems = [];
  let total = 0;
  let offset = 0;
  let activeFilter = 'all';
  let searchQuery = '';

  async function loadPage(pageOffset) {
    const data = await api('tasks?limit=' + TASKS_PAGE_SIZE + '&offset=' + pageOffset);
    const items = data.items || data.tasks || [];
    total = data.total || items.length;
    return items;
  }

  try {
    const firstPage = await loadPage(0);
    allItems = firstPage;
    offset = firstPage.length;
  } catch (err) {
    app.innerHTML = '';
    const section = makeSection('Tasks', '');
    section.appendChild(createErrorState(() => renderTasksDetail(app)));
    app.appendChild(section);
    return;
  }

  app.innerHTML = '';
  const section = makeSection('Tasks', total + ' total');

  // Filter pills
  const filtersEl = document.createElement('div');
  filtersEl.className = 'filters';
  const filterLabels = ['All', 'Running', 'Completed', 'Failed', 'Cancelled'];
  const filterValues = ['all', 'running', 'completed', 'failed', 'cancelled'];

  for (let i = 0; i < filterValues.length; i++) {
    const val = filterValues[i];
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (val === 'all' ? ' active' : '');
    btn.textContent = filterLabels[i];
    btn.addEventListener('click', () => {
      activeFilter = val;
      filtersEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRows();
    });
    filtersEl.appendChild(btn);
  }
  section.appendChild(filtersEl);

  // Search input
  const searchEl = document.createElement('input');
  searchEl.className = 'search-input';
  searchEl.placeholder = 'Search by agent or task description...';
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value.toLowerCase().trim();
    renderRows();
  });
  section.appendChild(searchEl);

  // Search scope indicator
  const scopeEl = document.createElement('div');
  scopeEl.style.cssText = 'font-size:11px;color:var(--text-3);margin-bottom:6px;min-height:16px';
  section.appendChild(scopeEl);

  // Data view
  const columns = [
    { key: 'status', label: '', sortable: false },
    { key: 'agent', label: 'Agent', sortable: false },
    { key: 'task', label: 'Task', sortable: false },
    { key: 'duration', label: 'Duration', sortable: false, align: 'right' },
    { key: 'tokens', label: 'Tokens', sortable: false, align: 'right' },
    { key: 'cost', label: 'Cost', sortable: false, align: 'right' },
    { key: 'time', label: 'Time', sortable: false, align: 'right' },
  ];

  const expansion = createExpansionManager();

  const dataView = createDataView({
    columns,
    gridTemplateColumns: TASKS_GRID,
    onLoadMore: async () => {
      const nextPage = await loadPage(offset);
      allItems = allItems.concat(nextPage);
      offset += nextPage.length;
      renderRows();
    },
  });

  section.appendChild(dataView);

  function getFiltered() {
    return allItems.filter(t => {
      if (activeFilter !== 'all' && t.status !== activeFilter) return false;
      if (searchQuery) {
        const agentMatch = (t.agentId || '').toLowerCase().includes(searchQuery);
        const taskMatch = (t.task || '').toLowerCase().includes(searchQuery);
        if (!agentMatch && !taskMatch) return false;
      }
      return true;
    });
  }

  function renderRows() {
    const rows = dataView._dataView;
    rows.clear();

    const filtered = getFiltered();

    // Search scope indicator
    if (searchQuery && offset < total) {
      scopeEl.textContent = '(searching ' + allItems.length + ' loaded of ' + total + ' total)';
    } else {
      scopeEl.textContent = '';
    }

    // Load-more visibility
    rows.setLoadMoreVisible(offset < total);

    if (filtered.length === 0) {
      rows.rows.appendChild(
        createEmptyState(
          searchQuery || activeFilter !== 'all' ? 'No matching tasks' : 'No tasks yet',
          (searchQuery || activeFilter !== 'all') ? () => {
            searchEl.value = '';
            searchQuery = '';
            activeFilter = 'all';
            filtersEl.querySelectorAll('.filter-btn').forEach((b, i) => {
              b.classList.toggle('active', i === 0);
            });
            renderRows();
          } : null
        )
      );
      return;
    }

    // Date group separators
    let lastGroupLabel = null;
    let lastTimestamp = null;

    for (const t of filtered) {
      const ts = t.timestamp || t.startedAt || null;

      // Insert date group if gap > 1 hour or label changed
      if (ts) {
        const label = dateGroupLabel(ts);
        const gap = lastTimestamp ? (new Date(lastTimestamp).getTime() - new Date(ts).getTime()) : Infinity;
        if (label !== lastGroupLabel || gap > 3600000) {
          if (label) {
            rows.rows.appendChild(createDateGroup(label));
            lastGroupLabel = label;
          }
        }
        lastTimestamp = ts;
      }

      const provider = inferProvider(t.agentId);
      const cost = estimateCost(provider, t.inputTokens, t.outputTokens);
      const totalTokens = (t.inputTokens || 0) + (t.outputTokens || 0);
      const tokensStr = totalTokens > 0 ? formatMetric(totalTokens) : '—';
      const dur = formatDuration(t.duration);
      const timeStr = ts ? timeAgo(ts) : '—';
      const firstLine = (t.task || '').replace(/\n[\s\S]*/m, '').slice(0, 100);

      const cells = [
        { content: statusDot(t.status), className: 'data-cell--center' },
        { content: e(t.agentId || ''), className: 'data-cell--mono' },
        { content: e(firstLine) },
        { content: dur, className: 'data-cell--right data-cell--mono' },
        { content: tokensStr, className: 'data-cell--right data-cell--mono' },
        { content: cost, className: 'data-cell--right data-cell--mono' },
        { content: timeStr, className: 'data-cell--right' },
      ];

      const row = createDataRow(cells, (rowEl) => {
        const isExpanded = rowEl.classList.contains('data-row--expanded');

        // Collapse any previously expanded row
        expansion.expand(rowEl);

        if (isExpanded) {
          rowEl.classList.remove('data-row--expanded');
          const panel = rowEl.nextElementSibling;
          if (panel && panel.classList.contains('data-expand')) panel.remove();
          return;
        }

        rowEl.classList.add('data-row--expanded');

        // Build expansion panel
        const expand = document.createElement('div');
        expand.className = 'data-expand';

        // Full task text
        if (t.task) {
          const taskBlock = document.createElement('div');
          taskBlock.className = 'expand-block';
          taskBlock.innerHTML =
            '<div class="expand-label">Task</div>' +
            '<pre class="expand-pre">' + e(t.task) + '</pre>';
          expand.appendChild(taskBlock);
        }

        // Result
        if (t.result) {
          const resultBlock = document.createElement('div');
          resultBlock.className = 'expand-block';
          resultBlock.innerHTML =
            '<div class="expand-label">Result</div>' +
            '<pre class="expand-pre">' + e(t.result) + '</pre>';
          expand.appendChild(resultBlock);
        }

        // Token breakdown
        if (t.inputTokens || t.outputTokens) {
          const tokenBlock = document.createElement('div');
          tokenBlock.className = 'expand-block';
          tokenBlock.innerHTML =
            '<div class="expand-label">Tokens</div>' +
            '<div class="expand-meta">' +
              'Input: <strong>' + formatMetric(t.inputTokens || 0) + '</strong>' +
              ' &nbsp; Output: <strong>' + formatMetric(t.outputTokens || 0) + '</strong>' +
              ' &nbsp; Cost: <strong>' + cost + '</strong>' +
            '</div>';
          expand.appendChild(tokenBlock);
        }

        // Task ID + consensus link
        const metaBlock = document.createElement('div');
        metaBlock.className = 'expand-block expand-meta-row';
        let metaHtml = '';
        if (t.taskId) {
          metaHtml += '<span class="expand-id">ID: ' + e(t.taskId) + '</span>';
        }
        if (t.consensusId || t.taskId) {
          const cId = t.consensusId || t.taskId;
          metaHtml += ' <a href="#/consensus/' + encodeURIComponent(cId) + '" class="expand-link">View consensus</a>';
        }
        if (metaHtml) {
          metaBlock.innerHTML = metaHtml;
          expand.appendChild(metaBlock);
        }

        rowEl.insertAdjacentElement('afterend', expand);
      }, TASKS_GRID);

      if (t.status === 'running') {
        row.classList.add('data-row--running');
      }

      rows.rows.appendChild(row);
    }
  }

  renderRows();
  app.appendChild(section);
}
