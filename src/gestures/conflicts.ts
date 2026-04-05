/**
 * Conflict resolution for simultaneous gesture detections.
 *
 * Rules:
 * - Different groups coexist (e.g. "navigation" + "hover" both fire)
 * - Same group: highest priority wins
 * - Equal priority: first registered wins (stable)
 */

import type { GestureDetection, ViewState, GestureConfig } from "./types";

interface ResolvedGesture {
  detection: GestureDetection;
  priority: number;
  group: string;
  apply: (
    detection: GestureDetection,
    viewState: ViewState,
    config: GestureConfig
  ) => ViewState;
}

/**
 * Given all active detections, resolve conflicts and return the winning
 * set of gesture applications to run.
 */
export function resolveConflicts(
  active: ResolvedGesture[]
): ResolvedGesture[] {
  if (active.length <= 1) return active;

  // Group by conflict group
  const groups = new Map<string, ResolvedGesture[]>();
  for (const g of active) {
    const existing = groups.get(g.group);
    if (existing) {
      existing.push(g);
    } else {
      groups.set(g.group, [g]);
    }
  }

  // Pick highest priority per group
  const winners: ResolvedGesture[] = [];
  for (const [, members] of groups) {
    members.sort((a, b) => b.priority - a.priority);
    winners.push(members[0]);
  }

  return winners;
}
