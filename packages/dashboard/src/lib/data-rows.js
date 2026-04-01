// ═══ Data Row Library ═══
// Shared infrastructure for all detail views.

const COST_RATES = {
  anthropic: { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  google:    { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
  default:   { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

function formatMetric(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function estimateCost(provider, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return '—';
  const rates = COST_RATES[provider] || COST_RATES.default;
  const cost = (inputTokens || 0) * rates.input + (outputTokens || 0) * rates.output;
  if (cost < 0.005) return '<$0.01';
  return '$' + cost.toFixed(2);
}

function createExpansionManager() {
  let current = null;
  return {
    expand(row) {
      if (current && current !== row) {
        current.classList.remove('data-row--expanded');
        const oldPanel = current.nextElementSibling;
        if (oldPanel && oldPanel.classList.contains('data-expand')) {
          oldPanel.remove();
        }
      }
      current = row;
    },
    collapse() {
      if (current) {
        current.classList.remove('data-row--expanded');
        const panel = current.nextElementSibling;
        if (panel && panel.classList.contains('data-expand')) {
          panel.remove();
        }
        current = null;
      }
    },
    current() { return current; },
  };
}

function createDataView(options) {
  const {
    columns, defaultSort, defaultOrder = 'desc',
    onSort, onLoadMore, total = 0,
    gridTemplateColumns,
  } = options;

  const container = document.createElement('div');
  container.className = 'data-view';

  let sortKey = defaultSort;
  let sortDir = defaultOrder;

  // Header
  const header = document.createElement('div');
  header.className = 'data-header';
  header.style.gridTemplateColumns = gridTemplateColumns;

  columns.forEach(col => {
    const cell = document.createElement('div');
    cell.className = 'data-cell' + (col.align === 'right' ? ' data-cell--right' : col.align === 'center' ? ' data-cell--center' : '');

    if (col.sortable !== false) {
      cell.setAttribute('data-sort', col.key);
      const arrow = col.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      cell.innerHTML = _dash.escapeHtml(col.label) + (arrow ? '<span class="data-sort data-sort--active">' + arrow + '</span>' : '');
      cell.addEventListener('click', () => {
        if (sortKey === col.key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = col.key;
          sortDir = 'desc';
        }
        header.querySelectorAll('[data-sort]').forEach(c => {
          const k = c.getAttribute('data-sort');
          const isActive = k === sortKey;
          const arrowText = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          const labelText = columns.find(cc => cc.key === k)?.label || '';
          c.innerHTML = _dash.escapeHtml(labelText) + (arrowText ? '<span class="data-sort data-sort--active">' + arrowText + '</span>' : '');
        });
        if (onSort) onSort(sortKey, sortDir);
      });
    } else {
      cell.textContent = col.label;
    }

    header.appendChild(cell);
  });

  container.appendChild(header);

  // Scrollable rows area
  const rows = document.createElement('div');
  rows.className = 'data-rows';
  container.appendChild(rows);

  // Load more
  const loadMoreDiv = document.createElement('div');
  loadMoreDiv.className = 'data-load-more';
  loadMoreDiv.style.display = 'none';
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.textContent = 'Load more';
  loadMoreBtn.addEventListener('click', async () => {
    loadMoreBtn.textContent = 'Loading...';
    loadMoreBtn.disabled = true;
    try {
      if (onLoadMore) await onLoadMore();
    } finally {
      loadMoreBtn.textContent = 'Load more';
      loadMoreBtn.disabled = false;
    }
  });
  loadMoreDiv.appendChild(loadMoreBtn);
  container.appendChild(loadMoreDiv);

  container._dataView = {
    rows,
    setLoadMoreVisible(visible) {
      loadMoreDiv.style.display = visible ? 'flex' : 'none';
    },
    clear() {
      rows.innerHTML = '';
    },
    getSortState() { return { key: sortKey, dir: sortDir }; },
  };

  return container;
}

function createDataRow(cells, onExpand, gridTemplateColumns) {
  const row = document.createElement('div');
  row.className = 'data-row';
  row.style.gridTemplateColumns = gridTemplateColumns;

  cells.forEach(cell => {
    const el = document.createElement('div');
    el.className = 'data-cell' + (cell.className ? ' ' + cell.className : '');
    if (typeof cell.content === 'string') {
      el.innerHTML = cell.content;
    } else if (cell.content instanceof HTMLElement) {
      el.appendChild(cell.content);
    }
    row.appendChild(el);
  });

  if (onExpand) {
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      onExpand(row);
    });
  }

  return row;
}

function createDateGroup(label) {
  const el = document.createElement('div');
  el.className = 'data-group';
  el.textContent = label;
  return el;
}

function createEmptyState(message, onClear) {
  const el = document.createElement('div');
  el.className = 'data-empty';
  if (onClear) {
    el.innerHTML = _dash.escapeHtml(message) + ' <a>Clear filters</a>';
    el.querySelector('a').addEventListener('click', onClear);
  } else {
    el.textContent = message;
  }
  return el;
}

function createErrorState(onRetry) {
  const el = document.createElement('div');
  el.className = 'data-error';
  el.innerHTML = 'Failed to load' + (onRetry ? ' — <a>Retry</a>' : '');
  if (onRetry) el.querySelector('a').addEventListener('click', onRetry);
  return el;
}

window._dataRows = {
  createDataView,
  createDataRow,
  createDateGroup,
  createExpansionManager,
  createEmptyState,
  createErrorState,
  formatMetric,
  estimateCost,
};
