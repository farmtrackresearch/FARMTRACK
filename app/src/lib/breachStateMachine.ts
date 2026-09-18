import type { FenceEval } from '@/lib/utils';

/**
 * Per-animal boundary breach state machine: in_bounds -> breach_active -> resolved.
 * Pure function — no timers, no side effects — so the same logic can run
 * client-side against `locations` today or move into a server-side scheduled
 * job / Supabase Edge Function later without a rewrite.
 */
export type BreachRecord = {
  fenceId: string | null;
  fenceName: string | null;
  startedAt: number;
  alertId: string;
};

export type BreachTransition =
  | {
      type: 'enter_breach';
      livestockId: string;
      fenceId: string | null;
      fenceName: string | null;
      distanceMeters: number;
    }
  | {
      type: 'resolve_breach';
      livestockId: string;
      record: BreachRecord;
      durationMs: number;
    };

export function stepBreachStateMachine(
  evaluations: { livestockId: string; evaluation: FenceEval }[],
  prevRecords: Record<string, BreachRecord>
): BreachTransition[] {
  const transitions: BreachTransition[] = [];

  for (const { livestockId, evaluation } of evaluations) {
    const prev = prevRecords[livestockId];
    if (evaluation.state === 'breach') {
      if (!prev) {
        transitions.push({
          type: 'enter_breach',
          livestockId,
          fenceId: evaluation.fenceId,
          fenceName: evaluation.fenceName,
          distanceMeters: evaluation.distanceMeters,
        });
      }
    } else if (prev) {
      transitions.push({
        type: 'resolve_breach',
        livestockId,
        record: prev,
        durationMs: Date.now() - prev.startedAt,
      });
    }
  }

  return transitions;
}
