export function formatPlatformLabel(platform: "facebook" | "instagram") {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    default:
      return platform;
  }
}

export function formatStatusLabel(status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
