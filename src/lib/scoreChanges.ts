import { normalizeBreakdown, type RawScores } from "./gradingEngine";

const fields = ["cw", "hw", "tests", "project", "exam"] as const;
type Field = typeof fields[number];
export type MarkChange = { field: Field; index: number; value: string | number };

export function changedMarks(before: RawScores, after: RawScores): MarkChange[] {
  const changes: MarkChange[] = [];
  for (const field of fields) {
    const oldValues = [before[field]].flat();
    const newValues = [after[field]].flat();
    newValues.forEach((value, index) => {
      if (String(value ?? "") !== String(oldValues[index] ?? "")) {
        changes.push({ field, index, value: value ?? "" });
      }
    });
  }
  return changes;
}

export function mergeMarks(existing: unknown, changes: unknown): RawScores {
  const raw = normalizeBreakdown(existing);
  if (!Array.isArray(changes) || changes.length > 25) throw new Error("Invalid mark changes.");
  const seen = new Set<string>();
  for (const change of changes) {
    if (!change || !fields.includes(change.field)) throw new Error("Unknown assessment field.");
    const { field, index, value } = change as MarkChange;
    const size = Array.isArray(raw[field]) ? (raw[field] as unknown[]).length : 1;
    const key = field + index;
    if (!Number.isInteger(index) || index < 0 || index >= size || seen.has(key) ||
        (typeof value !== "number" && typeof value !== "string") ||
        (value !== "" && (!String(value).trim() || !Number.isFinite(Number(value))))) {
      throw new Error("Invalid assessment mark.");
    }
    seen.add(key);
    if (field === "project" || field === "exam") raw[field] = value;
    else raw[field][index] = value;
  }
  return raw;
}
