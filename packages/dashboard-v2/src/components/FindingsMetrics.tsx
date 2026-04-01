import type { ConsensusData } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

interface FindingsMetricsProps {
  consensus: ConsensusData;
}

const MAX_RUNS = 5;

export function FindingsMetrics({ consensus }: FindingsMetricsProps) {
  const runs = consensus.runs.slice(0, MAX_RUNS);
  const hasMore = consensus.runs.length > MAX_RUNS;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          Consensus Rounds <span className="text-primary">{consensus.runs.length}</span>
        </h2>
        {hasMore && (
          <a
            href="#/findings"
            className="font-mono text-xs text-muted-foreground transition hover:text-primary"
          >
            view all →
          </a>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No consensus runs yet.</div>
      ) : (
        <div className="space-y-2">
          {runs.map((run, i) => {
            const c = run.counts;
            const runTotal = (c.agreement || 0) + (c.disagreement || 0) + (c.hallucination || 0) + (c.unverified || 0) + (c.unique || 0) + (c.new || 0);
            const barTotal = runTotal || 1;

            const segments = [
              { key: 'confirmed', count: c.agreement || 0, color: 'bg-confirmed', text: 'text-confirmed', label: 'confirmed' },
              { key: 'disputed', count: (c.disagreement || 0) + (c.hallucination || 0), color: 'bg-disputed', text: 'text-disputed', label: 'disputed' },
              { key: 'unverified', count: c.unverified || 0, color: 'bg-unverified', text: 'text-unverified', label: 'unverified' },
              { key: 'unique', count: (c.unique || 0) + (c.new || 0), color: 'bg-unique', text: 'text-unique', label: 'unique' },
            ];

            return (
              <div key={run.taskId + i} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-foreground">{runTotal} findings</span>
                    <div className="flex gap-1.5">
                      {run.agents.slice(0, 4).map((a) => (
                        <span key={a} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {a.split('-').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      ))}
                      {run.agents.length > 4 && (
                        <span className="font-mono text-[10px] text-muted-foreground">+{run.agents.length - 4}</span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{timeAgo(run.timestamp)}</span>
                </div>

                <div className="mt-2 flex gap-2">
                  {segments.map((s) => s.count > 0 && (
                    <span key={s.key} className={`font-mono text-[10px] font-semibold ${s.text}`}>
                      {s.count} {s.label}
                    </span>
                  ))}
                </div>

                <div className="mt-2 flex h-1.5 overflow-hidden rounded-sm">
                  {segments.map((s) => s.count > 0 && (
                    <div
                      key={s.key}
                      className={`${s.color} transition-all`}
                      style={{ width: `${(s.count / barTotal) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
