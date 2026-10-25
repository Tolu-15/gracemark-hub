/**
 * Terminal Results a student has already opened with a scratch card view, kept in this browser tab's memory
 * only. It lets the Results page and the Performance Summary page share one opened result, so looking at
 * both in the same visit costs one view, not two. It is never saved anywhere: refreshing the page or closing
 * the tab forgets it, and opening the result again then uses another view, exactly as the card rules say.
 *
 * The key includes the student's id, so a different student signing in on the same tab can never see it.
 */
export interface OpenedTr {
  report: any;
  card: { id: string; serial: string; status: string; viewsAllowed: number; viewsUsed: number; viewsLeft: number };
}

const store = new Map<string, OpenedTr>();

export const openedTrKey = (studentId: string | undefined, session: string, term: string) => `${studentId || "?"}|${session}|${term}`;

export function getOpenedTr(key: string): OpenedTr | null {
  return store.get(key) ?? null;
}

export function rememberOpenedTr(key: string, value: OpenedTr): void {
  store.set(key, value);
}

/** Forget everything, e.g. on sign-out. */
export function clearOpenedTr(): void {
  store.clear();
}
