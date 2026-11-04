import { useState } from 'react';
import { MockBadge } from '../../app/components/SourceBadge';
import { PanelShell } from '../../app/components/PanelShell';
import type { DomainPanelProps } from '../../app/panels';
import type { OpenTaskPayload } from './actions';

/** MOCK office task (Phase 0 compatibility test). No backend, no AI employee. */
const TASKS: Record<string, { title: string; owner: string; steps: string[] }> = {
  'weekly-supplier-report': {
    title: 'Weekly supplier report',
    owner: 'Farid (mock employee)',
    steps: ['Collect invoices from the three suppliers', 'Reconcile delivery dates against purchase orders', 'Flag late shipments for follow-up'],
  },
};

// Kept at module level so the checklist survives closing and reopening the panel.
const checked = new Map<string, boolean[]>();

export function TaskPanel({ action, onClose }: DomainPanelProps) {
  const taskId = ((action.payload ?? {}) as Partial<OpenTaskPayload>).taskId ?? '';
  const task = TASKS[taskId];
  const [done, setDone] = useState<boolean[]>(() => checked.get(taskId) ?? task?.steps.map(() => false) ?? []);

  if (!task) {
    return (
      <PanelShell title="Task not found" onClose={onClose} testId="task-panel">
        <p>No mock task with id “{taskId}”.</p>
      </PanelShell>
    );
  }
  const toggle = (i: number) => {
    const next = done.map((d, j) => (j === i ? !d : d));
    checked.set(taskId, next);
    setDone(next);
  };
  return (
    <PanelShell
      title={task.title}
      subtitle={`Assigned to ${task.owner}`}
      onClose={onClose}
      testId="task-panel"
      badges={<MockBadge>Mock task — no backend, no AI employee</MockBadge>}
    >
      <ul className="checklist">
        {task.steps.map((s, i) => (
          <li key={s}>
            <label>
              <input type="checkbox" checked={done[i] ?? false} onChange={() => toggle(i)} data-testid="task-step" /> {s}
            </label>
          </li>
        ))}
      </ul>
      <p className="muted">
        {done.filter(Boolean).length}/{task.steps.length} steps ticked. This panel only proves the engine can host a different domain.
      </p>
    </PanelShell>
  );
}
