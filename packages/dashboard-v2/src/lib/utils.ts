/** Clean <fn>, <cite>, <agent_finding>, and [FINDING] tags from finding text into HTML for rendering */
export function cleanFindingTags(text: string): string {
  let cleaned = text.replace(/^\[(FINDING|SUGGESTION|INSIGHT)\]\s*/i, '');
  // Strip <agent_finding> wrapper tags (content already extracted by engine, but may appear in evidence)
  cleaned = cleaned.replace(/<agent_finding[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/agent_finding>/g, '');
  // Style <cite> tags
  cleaned = cleaned.replace(/<cite\s+tag="file">([^<]+)<\/cite>/g, '<code class="cite-file">$1</code>');
  cleaned = cleaned.replace(/<cite\s+tag="fn">([^<]+)<\/cite>/g, '<code class="cite-fn">$1</code>');
  // Legacy <fn> tags
  cleaned = cleaned.replace(/<fn>([^<]+)<\/fn>/g, '<code class="cite-fn">$1</code>');
  return cleaned;
}

export function timeAgo(ts: string | number): string {
  const now = Date.now();
  const then = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function formatDuration(ms?: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

export function agentInitials(id: string): string {
  const parts = id.split('-');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return id.slice(0, 2).toUpperCase();
}

const AGENT_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#34d399',
  '#f43f5e', '#fbbf24', '#60a5fa', '#e879f9',
];

export function agentColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}
