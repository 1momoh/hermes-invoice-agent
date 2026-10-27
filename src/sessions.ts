// Server-issued chat sessions with TTL, a global cap and bounded history. Ids are never accepted from clients
// unless we issued them.
import { randomUUID } from "node:crypto";
import type { Action, Msg } from "./agent.js";

export type Session = { history: Msg[]; pending?: Action[]; owner: boolean; seen: number };
export const TTL_MS = Number(process.env.SESSION_TTL_MIN || 60) * 60_000;
export const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 500);
export const MAX_HISTORY = 40;
const store = new Map<string, Session>();

export function sweep(now = Date.now()) { for (const [k, s] of store) if (now - s.seen > TTL_MS) store.delete(k); }
export function create(owner: boolean): [string, Session] {
  sweep();
  while (store.size >= MAX_SESSIONS) store.delete(store.keys().next().value!); // evict least recently used
  const k = randomUUID(), s: Session = { history: [], owner, seen: Date.now() };
  store.set(k, s);
  return [k, s];
}
export function get(id: unknown): Session | undefined {
  const s = typeof id === "string" ? store.get(id) : undefined;
  if (!s) return;
  if (Date.now() - s.seen > TTL_MS) { store.delete(id as string); return; }
  s.seen = Date.now(); store.delete(id as string); store.set(id as string, s); // LRU order
  return s;
}
/** Keep the newest messages, starting on a user turn so tool results never lose their tool_calls message. */
export function trim(h: Msg[]) {
  if (h.length <= MAX_HISTORY) return;
  let cut = h.length - MAX_HISTORY;
  while (cut < h.length && !(h[cut].role === "user" && !String(h[cut].content).startsWith("ACTION RESULT"))) cut++;
  h.splice(0, cut);
}
export const size = () => store.size;
export const _clear = () => store.clear();
