export function isSchemaMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === "PGRST205" || code === "42703" || code === "42P01";
}
