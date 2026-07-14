export function formatPlatformLabel(
  platform: "facebook" | "instagram" | null | undefined,
): string {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    default:
      // Multi-platform drafts / legacy rows can have a null platform column.
      return "No platform";
  }
}

export function formatStatusLabel(status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
