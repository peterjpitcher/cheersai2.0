interface GeneratePostProps {
  campaignType: string;
  campaignName: string;
  businessName: string;
  eventDate: Date;
  postTiming: "week_before" | "day_before" | "day_of" | "hour_before" | "custom";
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
  const eventDay = eventDate.toLocaleDateString("en-GB", { weekday: "long" });
  const eventDateStr = eventDate.toLocaleDateString("en-GB", { 
    day: "numeric", 
    month: "long" 
  });
  const eventTime = (() => {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    const raw = eventDate.toLocaleTimeString('en-GB', opts);
    // Convert to lowercase and remove space before am/pm
    const lower = raw.replace(/\s*(AM|PM)$/i, (_, ap) => ap.toLowerCase());
    // Remove :00 minutes for whole hours
    return lower.replace(/:00(?=[ap]m$)/, '');
  })();

  const toneString = toneAttributes.join(", ").toLowerCase();
  
  const timingInstructions = {
    week_before: `This is a "save the date" post for next week. Create excitement and anticipation. Mention it's happening next ${eventDay}.`,
    day_before: `This is a reminder post for tomorrow. Build urgency and excitement. Use phrases like "Tomorrow night" or "See you tomorrow".`,
    day_of: `This is a same-day post. Create immediate urgency. Use phrases like "Tonight", "Today", or "Happening now".`,
    hour_before: `This is a final call post. Maximum urgency. Use phrases like "Starting in 1 hour", "Last chance", or "Doors open soon".`,
    custom: customDate ? `This is a custom scheduled post for ${customDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}. Create appropriate excitement based on the timing.` : `This is a custom scheduled post. Create engaging content appropriate for the timing.`
  };

  // Platform-specific guidelines
  const platformGuidelines: { [key: string]: string } = {
    facebook: "Keep it conversational and community-focused. Can be slightly longer (up to 500 characters). Use emojis naturally.",
    instagram_business: "Visual-first platform. Keep text concise (max 125 characters for optimal engagement). Use relevant emojis and consider adding a call-to-action.",
    twitter: "Maximum 280 characters. Be punchy and direct. Use 1-2 relevant hashtags maximum.",
    google_my_business: "Professional and informative. Include key details like opening hours if relevant. Optimize for local search (mention location/area).",
    linkedin: "Professional tone. Focus on business community and networking. Slightly more formal than other platforms."
  };

  const platformName = platform === "instagram_business" ? "Instagram" : 
                      platform === "google_my_business" ? "Google My Business" : 
                      platform.charAt(0).toUpperCase() + platform.slice(1);

  const basePrompt = `You are a social media expert for ${businessType}s in the UK. 
Write a ${platformName} post for ${businessName}.

Campaign: ${campaignName}
Type: ${campaignType}
Date: ${eventDateStr}
${eventTime && eventTime !== "00:00" ? `Time: ${eventTime}` : ""}
Target Audience: ${targetAudience}
Brand Voice: ${toneString}

${timingInstructions[postTiming]}

Platform: ${platformName}
${platformGuidelines[platform] || platformGuidelines.facebook}

Requirements:
- Optimize for ${platformName} best practices
- Match the ${toneString} tone
- Make it engaging and shareable
- UK English spelling
- Add a clear call-to-action
- Format any times in 12-hour style with lowercase am/pm and no leading zeros (e.g., 7pm, 8:30pm). Do not use 24-hour times.

Do not include hashtags unless specifically part of the event name.
Focus on creating genuine excitement without being overly promotional.`;

  return basePrompt;
}

export const POST_TIMINGS = [
  { id: "six_weeks", label: "6 Weeks Before", days: -42 },
  { id: "five_weeks", label: "5 Weeks Before", days: -35 },
  { id: "month_before", label: "1 Month Before", days: -30 },
  { id: "three_weeks", label: "3 Weeks Before", days: -21 },
  { id: "two_weeks", label: "2 Weeks Before", days: -14 },
  { id: "week_before", label: "1 Week Before", days: -7 },
  { id: "day_before", label: "Day Before", days: -1 },
  { id: "day_of", label: "Day Of Event", days: 0 },
  { id: "hour_before", label: "1 Hour Before", days: 0, hours: -1 },
] as const;
