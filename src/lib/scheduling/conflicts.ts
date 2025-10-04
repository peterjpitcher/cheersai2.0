export interface ScheduledSlot {
  id: string;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor: Date;
}

export interface ConflictResult {
  slot: ScheduledSlot;
  conflictWith?: ScheduledSlot;
  resolution?: Date;
}

const RESOLUTION_WINDOW_MINUTES = 120;

export function resolveConflicts(slots: ScheduledSlot[]): ConflictResult[] {
  const sorted = [...slots].sort(
    (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
  );

  const results: ConflictResult[] = [];
  const occupied: ScheduledSlot[] = [];

  for (const slot of sorted) {
    const conflict = occupied.find(
      (existing) =>
        existing.platform === slot.platform &&
        Math.abs(existing.scheduledFor.getTime() - slot.scheduledFor.getTime()) <
          30 * 60 * 1000,
    );

    if (!conflict) {
      occupied.push(slot);
      results.push({ slot });
      continue;
    }

    const resolution = findResolution(conflict);
    if (resolution) {
      const updatedSlot = { ...slot, scheduledFor: resolution };
      occupied.push(updatedSlot);
      results.push({ slot: updatedSlot, conflictWith: conflict, resolution });
    } else {
      results.push({ slot, conflictWith: conflict });
    }
  }

  return results;
}

function findResolution(conflict: ScheduledSlot) {
  const baseTime = conflict.scheduledFor.getTime();
  const offsets = [15, 30, 45, 60, -15, -30, -45, -60];

  for (const minutes of offsets) {
    const candidate = new Date(baseTime + minutes * 60 * 1000);
    if (
      Math.abs(candidate.getTime() - conflict.scheduledFor.getTime()) <=
      RESOLUTION_WINDOW_MINUTES * 60 * 1000
    ) {
      return candidate;
    }
  }

  return null;
}
