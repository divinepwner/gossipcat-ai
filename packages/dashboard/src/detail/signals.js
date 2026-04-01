// packages/dashboard/src/detail/signals.js — Full signal feed with grid layout, type filters, pagination

const SIGNALS_GRID = '120px 120px 120px 1fr 80px 80px';
const SIGNALS_PAGE_SIZE = 50;

const SIGNAL_TYPE_MAP = {
  agreement:     ['agreement', 'unique_confirmed'],
  disagreement:  ['disagreement'],
  unique:        ['unique_unconfirmed'],
  hallucination: ['hallucination_caught'],
};

function signalTagClass(signal) {
  const s = signal || '';
  if (s === 'agreement' || s === 'unique_confirmed') return 'tag-g';
  if (s === 'hallucination_caught') return 'tag-r';
  if (s === 'disagreement') return 'tag-r';
  if (s === 'unique_unconfirmed') return 'tag-u';
  return 'tag-b';
}

function signalTypeLabel(signal) {
  const labels = {
    agreement:          'AGREEMENT',
    unique_confirmed:   'CONFIRMED',
    disagreement:       'DISAGREE',
    hallucination_caught: 'HALLUC.',
    unique_unconfirmed: 'UNIQUE',
  };
  return labels[signal] || (signal || '').replace(/_/g, ' ').toUpperCase();
}

async function renderSignalsDetail(app) {
  const { api, escapeHtml: e, timeAgo, makeSection } = window._dash;
  const { createDataView, createDataRow, createExpansionManager,
          createEmptyState, createErrorState } = window._dataRows;

  app.innerHTML = '<div class="loading">Loading signals...</div>';

  let allItems = [];
  let total = 0;
  let offset = 0;
  let activeFilter = 'all';

  async function loadPage(pageOffset) {
    const data = await api('signals?limit=' + SIGNALS_PAGE_SIZE + '&offset=' + pageOffset);
    const items = data.items || data.signals || [];
    total = data.total != null ? data.total : items.length;
    return items;
  }

  try {
    const firstPage = await loadPage(0);
    allItems = firstPage;
    offset = firstPage.length;
  } catch (err) {
    app.innerHTML = '';
    const section = makeSection('Signals', '');
    section.appendChild(createErrorState(() => renderSignalsDetail(app)));
    app.appendChild(section);
    return;
  }

  app.innerHTML = '';
  const section = makeSection('Signals', total + ' total');

  // Filter pills
  const filtersEl = document.createElement('div');
  filtersEl.className = 'filters';
  const filterLabels = ['All', 'Agreement', 'Disagreement', 'Unique', 'Hallucination'];
  const filterValues = ['all', 'agreement', 'disagreement', 'unique', 'hallucination'];

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

  // Data view
  const columns = [
    { key: 'type',        label: 'Type',        sortable: false },
    { key: 'agent',       label: 'Agent',       sortable: false },
    { key: 'counterpart', label: 'Counterpart',  sortable: false },
    { key: 'evidence',    label: 'Evidence',    sortable: false },
    { key: 'task',        label: 'Task',        sortable: false },
    { key: 'time',        label: 'Time',        sortable: false, align: 'right' },
  ];

  const expansion = createExpansionManager();

  const dataView = createDataView({
    columns,
    gridTemplateColumns: SIGNALS_GRID,
    onLoadMore: async () => {
      const nextPage = await loadPage(offset);
      allItems = allItems.concat(nextPage);
      offset += nextPage.length;
      renderRows();
    },
  });

  section.appendChild(dataView);

  function getFiltered() {
    return allItems.filter(s => {
      if (activeFilter === 'all') return true;
      const allowed = SIGNAL_TYPE_MAP[activeFilter] || [];
      return allowed.includes(s.signal || '');
    });
  }

  function renderRows() {
    const rows = dataView._dataView;
    rows.clear();

    const filtered = getFiltered();

    rows.setLoadMoreVisible(offset < total);

    if (filtered.length === 0) {
      const hasFilter = activeFilter !== 'all';
      rows.rows.appendChild(
        createEmptyState(
          hasFilter ? 'No matching signals' : 'No signals yet',
          hasFilter ? () => {
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

    for (const s of filtered) {
      const tc = signalTagClass(s.signal);
      const typeLabel = signalTypeLabel(s.signal);
      const agentId = e(s.agentId || '—');
      const counterpart = e(s.counterpartId || '—');
      const evidenceText = e((s.evidence || s.finding || '').slice(0, 120));
      const taskId = s.taskId || '';
      const shortId = taskId ? taskId.slice(0, 8) : '—';
      const taskCell = taskId
        ? '<a href="#/consensus/' + encodeURIComponent(taskId) + '">' + e(shortId) + '</a>'
        : '—';
      const timeStr = s.timestamp ? timeAgo(s.timestamp) : '—';

      const cells = [
        { content: '<span class="finding-tag ' + tc + '">' + e(typeLabel) + '</span>' },
        { content: agentId, className: 'data-cell--mono' },
        { content: counterpart, className: 'data-cell--mono' },
        { content: evidenceText },
        { content: taskCell, className: 'data-cell--mono' },
        { content: timeStr, className: 'data-cell--right' },
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

        const expand = document.createElement('div');
        expand.className = 'data-expand';

        // Full evidence text
        const evidenceFull = s.evidence || s.finding || '';
        if (evidenceFull) {
          const block = document.createElement('div');
          block.className = 'expand-block';
          block.innerHTML =
            '<div class="expand-label">Evidence</div>' +
            '<pre class="expand-pre">' + e(evidenceFull) + '</pre>';
          expand.appendChild(block);
        }

        // Meta: task ID + consensus link
        const metaBlock = document.createElement('div');
        metaBlock.className = 'expand-block expand-meta-row';
        let metaHtml = '';
        if (s.agentId) {
          metaHtml += '<span class="expand-id">Agent: ' + e(s.agentId) + '</span>';
        }
        if (s.counterpartId) {
          metaHtml += ' <span class="expand-id">Counterpart: ' + e(s.counterpartId) + '</span>';
        }
        if (taskId) {
          metaHtml += ' <a href="#/consensus/' + encodeURIComponent(taskId) + '" class="expand-link">View consensus run</a>';
        }
        if (metaHtml) {
          metaBlock.innerHTML = metaHtml;
          expand.appendChild(metaBlock);
        }

        rowEl.insertAdjacentElement('afterend', expand);
      }, SIGNALS_GRID);

      rows.rows.appendChild(row);
    }
  }

  renderRows();
  app.appendChild(section);
}
