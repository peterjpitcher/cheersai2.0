export interface WeeklyAdvancedOptions {
  toneAdjust: string;
  lengthPreference: string;
  includeHashtags: boolean;
  includeEmojis: boolean;
  ctaStyle: string;
}

export interface WeeklyLinkOptions {
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  linkInBioUrl?: string | null;
}

const DEFAULT_WEEKLY_ADVANCED: WeeklyAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

export function clampDay(day: number) {
  if (Number.isNaN(day)) return 0;
  if (day < 0) return 0;
  if (day > 6) return 6;
  return day;
}

export function getFirstOccurrenceAfter(start: Date, dayOfWeek: number, time: string, now: Date) {
  const startClone = new Date(start);
  const [rawHours, rawMinutes] = time.split(":");
  const hours = rawHours && rawHours.trim().length ? Number(rawHours) : Number.NaN;
  const minutes = rawMinutes && rawMinutes.trim().length ? Number(rawMinutes) : Number.NaN;
  const resolvedHours = Number.isNaN(hours) ? 19 : hours;
  const resolvedMinutes = Number.isNaN(minutes) ? 0 : minutes;
  startClone.setHours(resolvedHours, resolvedMinutes, 0, 0);

  if (startClone < start) {
    startClone.setDate(startClone.getDate() + 7);
  }

  const startDay = startClone.getDay();
  const delta = (dayOfWeek - startDay + 7) % 7;
  startClone.setDate(startClone.getDate() + delta);

  while (startClone < now) {
    startClone.setDate(startClone.getDate() + 7);
  }

  return startClone;
}

export function buildWeeklyCopy(
  name: string,
  description: string,
  date: Date,
  platform: string,
  advanced?: WeeklyAdvancedOptions,
  link?: WeeklyLinkOptions,
) {
  const options = {
    ...DEFAULT_WEEKLY_ADVANCED,
    ...(advanced ?? {}),
  };

  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  const time = formatFriendlyTime(date);
  const trimmedDescription = description.trim();

  let base = `We're hosting ${name} this ${weekday} at ${time}. ${trimmedDescription}`.trim();

  if (options.lengthPreference === "short") {
    base = `We're hosting ${name} this ${weekday} at ${time}.`;
  } else if (options.lengthPreference === "detailed") {
    base = `We're hosting ${name} this ${weekday} at ${time}. ${trimmedDescription}\nExpect warm welcomes, great drinks, and good company.`.trim();
  }

  switch (options.toneAdjust) {
    case "more_formal":
      base = base.replace(/!+/g, ".");
      if (!/We (look forward|would be delighted)/i.test(base)) {
        base = `${base}\nWe look forward to hosting you.`;
      }
      break;
    case "more_casual":
      base = `${base}\nBring your pals and settle in!`;
      break;
    case "more_playful":
      base = `${base}\nLet’s make it a night to remember!`;
      break;
    case "more_serious":
      base = base.replace(/!+/g, ".");
      break;
  }

  const lines: string[] = [base];
  const cta = buildWeeklyCta(platform, options.ctaStyle);
  const hasLink = Boolean(link?.linkInBioUrl || link?.ctaUrl);
  if (platform === "instagram") {
    if (hasLink) {
      const label = link?.ctaLabel?.trim();
      const linkLine = label
        ? `${label.replace(/[.!?]+$/g, "")} via the link in our bio.`
        : "See the link in our bio for details.";
      lines.push(linkLine);
    }
  } else if (cta) {
    lines.push(cta);
  }

  if (platform === "facebook" && link?.ctaUrl) {
    const label = link?.ctaLabel?.trim() || "Book a table";
    lines.push(`${label}: ${link.ctaUrl}`);
  }

  if (options.includeEmojis && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last]} 🎉`;
  }

  if (options.includeHashtags && platform !== "gbp") {
    lines.push("#cheersai #weeklyspecial");
  }

  return lines.join("\n");
}

function buildWeeklyCta(platform: string, style: string) {
  switch (style) {
    case "direct":
      return platform === "gbp" ? "Book with us to secure your visit." : "Book now to lock in your spot.";
    case "urgent":
      return platform === "gbp"
        ? "Limited slots available — act quickly with us!"
        : "Spaces are limited, grab yours now with us!";
    default:
      if (platform === "gbp") {
        return "Tap to learn more and book your spot with us.";
      }
      return platform === "instagram" ? null : "Book your table now!";
  }
}

function formatFriendlyTime(date: Date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = ((hours + 11) % 12) + 1;
  if (minutes === 0) {
    return `${hour12}${suffix}`;
  }
  const minuteStr = minutes.toString().padStart(2, "0");
  return `${hour12}:${minuteStr}${suffix}`;
}
