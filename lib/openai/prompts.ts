interface GeneratePostProps {
  campaignType: string;
  campaignName: string;
  businessName: string;
  eventDate: Date;
  postTiming: "week_before" | "day_before" | "day_of" | "hour_before";
  toneAttributes: string[];
  businessType: string;
  targetAudience: string;
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
}: GeneratePostProps): string {
  const eventDay = eventDate.toLocaleDateString("en-GB", { weekday: "long" });
  const eventDateStr = eventDate.toLocaleDateString("en-GB", { 
    day: "numeric", 
    month: "long" 
  });
  const eventTime = eventDate.toLocaleTimeString("en-GB", { 
    hour: "numeric", 
    minute: "2-digit" 
  });

  const toneString = toneAttributes.join(", ").toLowerCase();
  
  const timingInstructions = {
    week_before: `This is a "save the date" post for next week. Create excitement and anticipation. Mention it's happening next ${eventDay}.`,
    day_before: `This is a reminder post for tomorrow. Build urgency and excitement. Use phrases like "Tomorrow night" or "See you tomorrow".`,
    day_of: `This is a same-day post. Create immediate urgency. Use phrases like "Tonight", "Today", or "Happening now".`,
    hour_before: `This is a final call post. Maximum urgency. Use phrases like "Starting in 1 hour", "Last chance", or "Doors open soon".`
  };

  const basePrompt = `You are a social media expert for ${businessType}s in the UK. 
Write a Facebook/Instagram post for ${businessName}.

Campaign: ${campaignName}
Type: ${campaignType}
Date: ${eventDateStr}
${eventTime !== "00:00" ? `Time: ${eventTime}` : ""}
Target Audience: ${targetAudience}
Brand Voice: ${toneString}

${timingInstructions[postTiming]}

Requirements:
- Keep it concise (max 3-4 sentences)
- Include relevant emojis
- Add a clear call-to-action
- Match the ${toneString} tone
- Make it engaging and shareable
- UK English spelling

Do not include hashtags unless specifically part of the event name.
Focus on creating genuine excitement without being overly promotional.`;

  return basePrompt;
}

export const POST_TIMINGS = [
  { id: "week_before", label: "1 Week Before", days: -7 },
  { id: "day_before", label: "Day Before", days: -1 },
  { id: "day_of", label: "Day Of Event", days: 0 },
  { id: "hour_before", label: "1 Hour Before", days: 0, hours: -1 },
] as const;