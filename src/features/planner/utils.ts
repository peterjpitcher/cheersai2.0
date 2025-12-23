export function formatPlatformLabel(platform: "facebook" | "instagram" | "gbp") {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "gbp":
      return "Google Business";
    default:
      return platform;
  }
}

export function formatStatusLabel(status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
