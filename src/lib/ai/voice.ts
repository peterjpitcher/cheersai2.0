export const TONE_PROFILE =
  "Warm, local, and practical. Sound like a real pub team: friendly, welcoming, and grounded. Avoid hype, corporate marketing language, or grand claims.";

export const BANNED_PHRASES: string[] = [
  // Original list
  "unforgettable experience",
  "electrifying night",
  "once-in-a-lifetime",
  "best in town",
  "you won't regret it",
  // Common AI pub-copy clichés
  "something for everyone",
  "an experience like no other",
  "a night to remember",
  "take your taste buds",
  "mouth-watering",
  "top-notch",
  "second to none",
  "why not pop in",
  "whether you're",
  "whatever your taste",
  "food and drink experience",
  "vibrant atmosphere",
  "bustling atmosphere",
  "warm and welcoming atmosphere",
  "cosy atmosphere",
  // Clinical/distancing language
  "the atmosphere",
  "atmosphere",
];

export const BANNED_PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // Original replacements
  { pattern: /\bunforgettable experience\b/gi, replacement: "great time" },
  { pattern: /\belectrifying night\b/gi, replacement: "lively night" },
  { pattern: /\bonce[- ]in[- ]a[- ]lifetime\b/gi, replacement: "special" },
  { pattern: /\bbest in town\b/gi, replacement: "local favourite" },
  { pattern: /\byou won[‘’]t regret it\b/gi, replacement: "" },
  // Extended replacements for newly banned phrases
  { pattern: /\bsomething for everyone\b/gi, replacement: "something you’ll enjoy" },
  { pattern: /\ban experience like no other\b/gi, replacement: "a great time" },
  { pattern: /\ba night to remember\b/gi, replacement: "a great night" },
  { pattern: /\btake your taste buds\b[^.!?\n]*/gi, replacement: "great food" },
  { pattern: /\bmouth[- ]watering\b/gi, replacement: "delicious" },
  { pattern: /\btop[- ]notch\b/gi, replacement: "great" },
  { pattern: /\bsecond to none\b/gi, replacement: "well worth a visit" },
  { pattern: /\bwhy not pop in\b/gi, replacement: "pop in" },
  { pattern: /\bvibrant atmosphere\b/gi, replacement: "great atmosphere" },
  { pattern: /\bbustling atmosphere\b/gi, replacement: "lively atmosphere" },
  { pattern: /\bwarm and welcoming atmosphere\b/gi, replacement: "warm welcome" },
  { pattern: /\bcosy atmosphere\b/gi, replacement: "cosy setting" },
  { pattern: /\bfood and drink experience\b/gi, replacement: "food and drink" },
  { pattern: /\b(?:the\s+)?atmosphere\b/gi, replacement: "vibe" },
];

export const PREFERRED_PHRASES: string[] = [
  "pop by",
  "join us",
  "book a table",
  "we’d love to see you",
  "good food and a warm welcome",
  "we’re serving",
  "our kitchen",
  "you’re always welcome",
];

export const HYPE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bthe best\b/gi, replacement: "a great" },
  { pattern: /\bbest ever\b/gi, replacement: "a great" },
  { pattern: /\bultimate\b/gi, replacement: "great" },
  { pattern: /\bworld[- ]class\b/gi, replacement: "excellent" },
  { pattern: /\blegendary\b/gi, replacement: "classic" },
  { pattern: /\bepic\b/gi, replacement: "great" },
  { pattern: /\bmust[- ]see\b/gi, replacement: "worth a visit" },
  { pattern: /\b(can't|cannot) miss\b/gi, replacement: "worth a visit" },
];

export function scrubBannedPhrases(value: string) {
  let output = value;
  const removed: string[] = [];
  for (const rule of BANNED_PHRASE_REPLACEMENTS) {
    if (rule.pattern.test(output)) {
      output = output.replace(rule.pattern, rule.replacement);
      removed.push(rule.pattern.source);
    }
    rule.pattern.lastIndex = 0;
  }
  return { value: output, removed };
}

export function reduceHype(value: string) {
  let output = value;
  const adjusted: string[] = [];
  for (const rule of HYPE_REPLACEMENTS) {
    if (rule.pattern.test(output)) {
      output = output.replace(rule.pattern, rule.replacement);
      adjusted.push(rule.pattern.source);
    }
    rule.pattern.lastIndex = 0;
  }
  return { value: output, adjusted };
}

export function detectBannedPhrases(value: string) {
  const hits: string[] = [];
  for (const rule of BANNED_PHRASE_REPLACEMENTS) {
    if (rule.pattern.test(value)) {
      hits.push(rule.pattern.source);
    }
    rule.pattern.lastIndex = 0;
  }
  return hits;
}
