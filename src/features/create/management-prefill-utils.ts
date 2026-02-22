export function findOverwriteConflicts<T extends string>(
  mapped: Partial<Record<T, string | undefined>>,
  current: Partial<Record<T, string | undefined>>,
): T[] {
  const conflicts: T[] = [];

  for (const [rawKey, rawMappedValue] of Object.entries(mapped)) {
    const key = rawKey as T;
    const mappedValue = normalizeValue(typeof rawMappedValue === "string" ? rawMappedValue : undefined);
    if (!mappedValue) continue;

    const currentValue = normalizeValue(current[key]);
    if (!currentValue) continue;

    if (currentValue !== mappedValue) {
      conflicts.push(key);
    }
  }

  return conflicts;
}

function normalizeValue(value: string | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}
