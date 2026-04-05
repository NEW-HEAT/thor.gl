/**
 * Gesture registry — noodles-style opTypes pattern.
 *
 * Handlers register by name. The engine queries the registry to fan-out
 * detection across all registered handlers.
 */

import type { GestureHandler, GestureRegistration } from "./types";
import type { BodyPart } from "../detection/types";

interface RegisteredGesture {
  handler: GestureHandler;
  priority: number;
  group: string;
}

const registry = new Map<string, RegisteredGesture>();

/** Register a gesture handler. Overwrites if name already exists. */
export function registerGesture(
  handler: GestureHandler,
  opts: GestureRegistration = {}
): void {
  registry.set(handler.name, {
    handler,
    priority: opts.priority ?? 10,
    group: opts.group ?? "navigation",
  });
}

/** Get a registered handler by name. */
export function getGesture(name: string): GestureHandler | undefined {
  return registry.get(name)?.handler;
}

/** List all registered handler names. */
export function listGestures(): string[] {
  return Array.from(registry.keys());
}

/** Get all registered gestures with their metadata. */
export function getAllGestures(): RegisteredGesture[] {
  return Array.from(registry.values());
}

/**
 * Get the subset of registered gestures matching a name filter.
 * If filter is undefined, returns all.
 */
export function getActiveGestures(
  filter?: string[]
): RegisteredGesture[] {
  if (!filter) return getAllGestures();
  return filter
    .map((name) => registry.get(name))
    .filter((g): g is RegisteredGesture => g !== undefined);
}

/**
 * Compute the union of all BodyParts required by the given gestures.
 * Used by the engine to determine detector mode in "auto".
 */
export function getRequiredParts(gestures: RegisteredGesture[]): Set<BodyPart> {
  const parts = new Set<BodyPart>();
  for (const g of gestures) {
    for (const part of g.handler.requires) {
      parts.add(part);
    }
  }
  return parts;
}

/** Remove a gesture handler by name. */
export function unregisterGesture(name: string): boolean {
  return registry.delete(name);
}

/** Clear the entire registry. */
export function clearRegistry(): void {
  registry.clear();
}
