// packages/dashboard/src/hub/team.js — Agent roster rows

function renderTeamSection(agents, liveTaskAgents) {
  var _dash = window._dash;
  var e = _dash.escapeHtml, navigate = _dash.navigate, makeSection = _dash.makeSection;
  var timeAgo = _dash.timeAgo, agentInitials = _dash.agentInitials;
  var section = makeSection('Team', agents.length + ' agents', 'all agents \u2192', '#/team');

  var roster = document.createElement('div');
  roster.className = 'roster';

  var sorted = agents.slice().sort(function(a, b) {
    return (b.scores?.dispatchWeight || 0) - (a.scores?.dispatchWeight || 0);
  });

  var liveSet = new Set(liveTaskAgents || []);

  for (var i = 0; i < sorted.length; i++) {
    var agent = sorted[i];
    var row = document.createElement('div');
    row.className = 'roster-row';
    row.dataset.agentId = agent.id;

    var w = agent.scores?.dispatchWeight ?? 1;
    var signals = agent.scores?.signals ?? 0;
    var accuracy = agent.scores?.accuracy ?? 0.5;
    var reliability = agent.scores?.reliability ?? 0.5;
    var uniqueness = agent.scores?.uniqueness ?? 0.5;

    var tierColor = signals === 0 ? 'var(--text-3)'
      : w >= 1.5 ? 'var(--green)'
      : w >= 0.8 ? 'var(--amber)'
      : 'var(--red)';

    // Health bar: normalize dispatchWeight from [0.3, 2.0] to [0, 1]
    var health = Math.min(1, Math.max(0, (w - 0.3) / 1.7));
    var healthPct = Math.round(health * 100);

    // Status: active if in live tasks, error if last task failed, else idle
    var isActive = liveSet.has(agent.id);
    var isError = agent.lastTask?.status === 'failed';
    var statusDot = isActive ? 'online' : isError ? 'error' : 'idle';
    var statusText = isActive ? 'ACTIVE' : isError ? 'ERROR' : 'IDLE';

    var lastTask = agent.lastTask;
    var lastText = lastTask
      ? e((lastTask.task || '').replace(/\n.*/s, '').slice(0, 60))
      : '';
    var lastTime = lastTask?.timestamp ? timeAgo(lastTask.timestamp) : '';

    row.innerHTML =
      '<span class="roster-badge" style="color:' + tierColor + '">' + agentInitials(agent.id) + '</span>' +
      '<span class="roster-name">' + e(agent.id) + '</span>' +
      '<div class="roster-bar-wrap">' +
        '<div class="roster-bar"><div class="roster-bar-fill" style="width:' + healthPct + '%;background:' + tierColor + '"></div></div>' +
        '<span class="roster-pct">' + healthPct + '%</span>' +
      '</div>' +
      '<div class="roster-status">' +
        '<span class="roster-dot ' + statusDot + '"></span>' +
        '<span>' + statusText + '</span>' +
      '</div>' +
      '<span class="roster-task">' + lastText + '</span>' +
      '<span class="roster-time">' + lastTime + '</span>' +
      '<div class="roster-tooltip">Acc: ' + Math.round(accuracy * 100) + '% | Rel: ' + Math.round(reliability * 100) + '% | Uniq: ' + Math.round(uniqueness * 100) + '%</div>';

    row.addEventListener('click', (function(id) {
      return function() { navigate('#/team/' + encodeURIComponent(id)); };
    })(agent.id));

    if (isActive) row.classList.add('roster-active');
    roster.appendChild(row);
  }

  section.appendChild(roster);
  return section;
}
