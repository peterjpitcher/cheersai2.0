export function normaliseTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed.length) return "";
  const withoutHash = trimmed.replace(/^#+/, "");
  return withoutHash.trim();
}

export function normaliseTags(tags?: string[] | null): string[] {
  if (!tags?.length) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalised = normaliseTag(tag);
    if (!normalised.length || seen.has(normalised)) continue;
    seen.add(normalised);
    result.push(normalised);
  }

  return result;
}
