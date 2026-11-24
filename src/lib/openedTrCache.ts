/**
 * The Results and Performance Summary pages can reuse a report in tab memory
 * when the server still reports the same active card for the selected term.
 *
 * The key includes the student's id, so a different student signing in on the same tab can never see it.
 */
export interface OpenedTr {
  report: any;
  card: { id: string; serial: string; status: string; viewsAllowed: number; viewsUsed: number; viewsLeft: number };
}

const store = new Map<string, OpenedTr>();

export const openedTrKey = (studentId: string | undefined, session: string, term: string) => `${studentId || "?"}|${session}|${term}`;

export function getOpenedTr(key: string, card: { id: string; status: string } | null | undefined): OpenedTr | null {
  const saved = store.get(key);
  return saved && card?.status === "active" && card.id === saved.card.id ? saved : null;
}

export function rememberOpenedTr(key: string, value: OpenedTr): void {
  store.set(key, value);
}

/** Forget everything, e.g. on sign-out. */
export function clearOpenedTr(): void {
  store.clear();
}
