// packages/dashboard/src/hub/knowledge.js — Flat text list of agent memories

function renderKnowledgeSection(agents) {
  const { escapeHtml: e, navigate, makeSection } = window._dash;
  const section = makeSection('Knowledge', agents.length + ' agents');

  const list = document.createElement('div');
  list.className = 'know-list';

  const projLink = document.createElement('button');
  projLink.className = 'know-item';
  projLink.textContent = '_project (shared)';
  projLink.addEventListener('click', () => navigate('#/knowledge/_project'));
  list.appendChild(projLink);

  const sorted = [...agents].sort((a, b) =>
    (b.scores?.dispatchWeight || 0) - (a.scores?.dispatchWeight || 0)
  );

  for (const agent of sorted) {
    const btn = document.createElement('button');
    btn.className = 'know-item';
    btn.textContent = agent.id;
    btn.addEventListener('click', () => navigate('#/knowledge/' + encodeURIComponent(agent.id)));
    list.appendChild(btn);
  }

  section.appendChild(list);
  return section;
}
