import type { AnimalStatus } from '@/types/database';

/**
 * Per-animal breach tracker: in_bounds -> breach_active -> resolved.
 *
 * The server decides fence state (detect_geofence_events); this only turns a
 * stream of server statuses into edges, so the app sounds the siren once when
 * an animal enters breach and stops it once the server says it has left —
 * however many times the same status is re-delivered (reloads, reconnects,
 * unrelated column updates). Pure function: no timers, no side effects.
 */
export type BreachRecord = {
  startedAt: number;
  /** Server alert id for this breach, once the boundary_breach alert has been seen. */
  alertId: string | null;
};

export type BreachTransition =
  | { type: 'enter_breach'; livestockId: string }
  | {
      type: 'resolve_breach';
      livestockId: string;
      record: BreachRecord;
      durationMs: number;
    };

export function stepBreachStateMachine(
  statuses: { livestockId: string; status: AnimalStatus }[],
  prevRecords: Record<string, BreachRecord>,
  now: number = Date.now()
): BreachTransition[] {
  const transitions: BreachTransition[] = [];
  const seen = new Set<string>();

  for (const { livestockId, status } of statuses) {
    seen.add(livestockId);
    const prev = prevRecords[livestockId];
    if (status === 'breach') {
      if (!prev) transitions.push({ type: 'enter_breach', livestockId });
    } else if (prev) {
      transitions.push({ type: 'resolve_breach', livestockId, record: prev, durationMs: now - prev.startedAt });
    }
  }

  // An animal deleted (or unassigned from this farm) while in breach must not
  // leave its siren running forever.
  for (const [livestockId, record] of Object.entries(prevRecords)) {
    if (!seen.has(livestockId)) {
      transitions.push({ type: 'resolve_breach', livestockId, record, durationMs: now - record.startedAt });
    }
  }

  return transitions;
}
