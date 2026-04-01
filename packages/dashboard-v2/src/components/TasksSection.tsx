import { useState } from 'react';
import type { TasksData } from '@/lib/types';
import { TaskRow } from './TaskRow';

const PAGE_SIZE = 25;

interface TasksSectionProps {
  tasks: TasksData;
}

export function TasksSection({ tasks }: TasksSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? tasks.items : tasks.items.slice(0, PAGE_SIZE);
  const remaining = tasks.items.length - PAGE_SIZE;

  return (
    <section>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-foreground">
        Tasks <span className="text-primary">{tasks.total}</span>
      </h2>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="py-2 pl-4 pr-2 text-xs font-medium text-muted-foreground" style={{ width: 32 }}></th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">ID</th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">Agent</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Description</th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">Duration</th>
              <th className="py-2 pr-4 text-right font-mono text-xs font-medium text-muted-foreground">When</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((task) => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </tbody>
        </table>
        {tasks.items.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No tasks yet.</div>
        )}
      </div>
      {remaining > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 w-full rounded-md border border-dashed border-border py-2 font-mono text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          show more ({remaining} remaining)
        </button>
      )}
    </section>
  );
}
