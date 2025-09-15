import { formatDate, formatTime } from '@/lib/datetime'

interface GeneratePostProps {
  campaignType: string;
  campaignName: string;
  businessName: string;
  eventDate: Date;
  postTiming:
    | "six_weeks"
    | "five_weeks"
    | "month_before"
    | "three_weeks"
    | "two_weeks"
    | "week_before"
    | "day_before"
    | "day_of"
    | "hour_before"
    | "custom";
  toneAttributes: string[];
  businessType: string;
  targetAudience: string;
  platform?: string;
  customDate?: Date;
}

export function generatePostPrompt({
  campaignType,
  campaignName,
  businessName,
  eventDate,
  postTiming,
  toneAttributes,
  businessType,
  targetAudience,
  platform = "facebook",
  customDate,
}: GeneratePostProps): string {
  const isOffer = String(campaignType || '').toLowerCase().includes('offer');
  const eventDay = formatDate(eventDate, undefined, { weekday: 'long' });
  const eventDateStr = formatDate(eventDate, undefined, { day: 'numeric', month: 'long' });
  const eventTime = formatTime(eventDate).replace(/:00(?=[ap]m$)/, '');

  const toneString = Array.from(new Set((toneAttributes || []).map(t => t.trim()).filter(Boolean))).join(', ');
  
  // Offsets are defined top-level in OFFSETS for reuse
  function addOffset(base: Date, off?: { days?: number; hours?: number }) {
    const d = new Date(base);
    if (typeof off?.days === 'number') d.setDate(d.getDate() + off.days);
    if (typeof off?.hours === 'number') d.setHours(d.getHours() + off.hours);
    return d;
  }
  function startOfWeek(d: Date) {
    const x = new Date(d);
    const day = x.getDay(); // 0=Sun..6=Sat
    // Make Monday the first day of the week
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diffToMonday);
    x.setHours(0,0,0,0);
    return x;
  }
  function isSameWeek(a: Date, b: Date) {
    const sa = startOfWeek(a).getTime();
    const sb = startOfWeek(b).getTime();
    return sa === sb;
  }
  function addDays(d: Date, n: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function toLocalISODate(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const dd = parts.find(p => p.type === 'day')?.value || '';
    const mm = parts.find(p => p.type === 'month')?.value || '';
    const yyyy = parts.find(p => p.type === 'year')?.value || '';
    return `${yyyy}-${mm}-${dd}`;
  }
  function relativeDescriptor(scheduled: Date, event: Date): string {
    const sd = new Date(scheduled);
    const ed = new Date(event);
    const dayName = formatDate(ed, undefined, { weekday: 'long', timeZone: 'Europe/London' });
    const sdYMD = toLocalISODate(sd, 'Europe/London');
    const edYMD = toLocalISODate(ed, 'Europe/London');
    if (sdYMD === edYMD) {
      return 'today';
    }
    const tomorrow = toLocalISODate(addDays(sd, 1), 'Europe/London');
    if (edYMD === tomorrow) {
      return 'tomorrow';
    }
    if (isSameWeek(sd, ed)) {
      return `this ${dayName.toLowerCase()}`;
    }
    if (isSameWeek(addDays(sd, 7), ed)) {
      return `next ${dayName.toLowerCase()}`;
    }
    // Fallback: use day name without numeric date to keep copy relative
    return `${dayName}`;
  }

  const scheduledDate = (postTiming === 'custom' && customDate)
    ? customDate
    : addOffset(eventDate, (OFFSETS as any)[postTiming] || {});

  const relHint = scheduledDate ? relativeDescriptor(scheduledDate, eventDate) : undefined;

  const timingInstructions: Record<string, string> = {
    six_weeks: `Early teaser six weeks out. Build awareness. Refer to the timing as '${relHint || eventDay}' (no numeric date).`,
    five_weeks: `Teaser five weeks out. Build awareness. Refer to the timing as '${relHint || eventDay}' (no numeric date).`,
    month_before: `One month before. Start encouraging plans. Refer to the timing as '${relHint || eventDay}' (no numeric date).`,
    three_weeks: `Three weeks before. Build momentum. Refer to the timing as '${relHint || eventDay}' (no numeric date).`,
    two_weeks: `Two weeks before. Encourage early booking. Refer to the timing as '${relHint || eventDay}' (no numeric date).`,
    week_before: `Save the date for next week. Mention it's happening ${relHint || `next ${eventDay.toLowerCase()}`}.`,
    day_before: `Reminder for tomorrow. Build urgency. Use phrases like 'Tomorrow night' and avoid numeric dates.`,
    day_of: `Same‑day post. Use 'Today' or 'Tonight' (no numeric date). Create immediate urgency.`,
    hour_before: `Final call about an hour before. Use 'Starting soon' / 'In 1 hour'.`,
    custom: `This is scheduled for ${relHint || eventDay}. Use accurate relative wording to the scheduled time (e.g., today, tonight, tomorrow). Avoid arbitrary day names unless truly correct.`,
  };

  // Platform-specific guidelines
  const platformGuidelines: { [key: string]: string } = {
    facebook: "Keep it conversational and community-focused. Can be slightly longer (up to 500 characters). Use emojis naturally.",
    instagram_business: "Visual-first platform. Keep text concise (max 125 characters for optimal engagement). Use relevant emojis and consider adding a call-to-action.",
    twitter: "Maximum 280 characters. Be punchy and direct. Use 1-2 relevant hashtags maximum.",
    google_my_business: "Professional and informative. Include key details like opening hours if relevant. Optimize for local search (mention location/area).",
  };

  // Platform-specific link instruction
  const linkInstruction =
    platform === 'instagram_business'
      ? "Do not include raw URLs. Refer to the profile link using the phrase 'link in bio'."
      : platform === 'google_my_business'
        ? "Do not paste URLs in the text. Refer to 'click the link below' because the post includes a separate CTA button."
        : "Include the URL inline once as a plain URL (no tracking parameters).";

  const platformName = platform === "instagram_business" ? "Instagram" : 
                      platform === "google_my_business" ? "Google Business Profile" : 
                      platform.charAt(0).toUpperCase() + platform.slice(1);

  const offerInstructions = isOffer
    ? `This is a limited-time offer. Emphasise urgency and clarity.
Do NOT include specific times or day-of-week anchors (e.g., Friday, Monday, tonight, tomorrow).
Explicitly include: "Offer ends ${relHint || eventDay}".
Keep copy evergreen within the offer window.`
    : ''

  const basePrompt = `You are a social media expert for ${businessType}s in the UK. 
Write a ${platformName} post for ${businessName}.

Campaign: ${campaignName}
Type: ${campaignType}
${!isOffer ? `Date: ${eventDateStr}` : ''}
${!isOffer ? (eventTime ? `Time: ${eventTime}` : "") : ""}
Target Audience: ${targetAudience}
Brand Voice: ${toneString}

${isOffer ? offerInstructions : (timingInstructions[postTiming] || '')}

Platform: ${platformName}
${platformGuidelines[platform] || platformGuidelines.facebook}

Requirements:
- Optimize for ${platformName} best practices
- Match the ${toneString} tone
- Make it engaging and shareable
- UK English spelling
- Add a clear call-to-action
- Format any times in 12-hour style with lowercase am/pm and no leading zeros (e.g., 7pm, 8:30pm). Do not use 24-hour times.
- Link handling: ${linkInstruction}
- Do not use any markdown or formatting markers (no **bold**, *italics*, backticks, or headings). Output plain text only suitable for direct posting.
- ${isOffer ? 'Do NOT mention specific days like Friday/Monday or times. Focus on the offer and that it ends ' + (relHint || eventDay) + '.' : `Use relative date wording (today, tomorrow, this Friday, next Friday) instead of numeric dates. For this post, refer to the timing as '${relHint || eventDay}'.`}
- Structure the copy as 2 short paragraphs separated by a single blank line. No bullet points.

Do not include hashtags unless specifically part of the event name.
Focus on creating genuine excitement without being overly promotional.`;

  return basePrompt;
}

const OFFSETS: Record<string, { days?: number; hours?: number }> = {
  six_weeks: { days: -42 },
  five_weeks: { days: -35 },
  month_before: { days: -30 },
  three_weeks: { days: -21 },
  two_weeks: { days: -14 },
  week_before: { days: -7 },
  day_before: { days: -1 },
  day_of: { days: 0 },
  hour_before: { hours: -1 },
}

const LABELS = {
  six_weeks: '6 Weeks Before',
  five_weeks: '5 Weeks Before',
  month_before: '1 Month Before',
  three_weeks: '3 Weeks Before',
  two_weeks: '2 Weeks Before',
  week_before: '1 Week Before',
  day_before: 'Day Before',
  day_of: 'Day Of Event',
  hour_before: '1 Hour Before',
} as const

export const POST_TIMINGS = (Object.keys(OFFSETS) as Array<keyof typeof LABELS>).map((id) => ({
  id,
  label: LABELS[id],
  days: (OFFSETS as any)[id]?.days ?? 0,
  hours: (OFFSETS as any)[id]?.hours,
}));
