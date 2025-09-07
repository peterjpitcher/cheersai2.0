export function computeBackoffMinutes(attempts: number, capMinutes = 60): number {
  // attempts is the number of attempts already made (>= 1 on first failure)
  if (!Number.isFinite(attempts) || attempts < 1) return 1; // fallback 1 minute
  const minutes = Math.pow(2, attempts);
  return Math.min(minutes, capMinutes);
}

export function nextAttemptDate(from: Date, attempts: number, capMinutes = 60): Date {
  const mins = computeBackoffMinutes(attempts, capMinutes);
  return new Date(from.getTime() + mins * 60 * 1000);
}

