export const TONE_PROFILE =
  "Warm, local, and practical. Sound like a real pub team: friendly, welcoming, and grounded. Avoid hype, corporate marketing language, or grand claims.";

export const BANNED_PHRASES: string[] = [
  "unforgettable experience",
  "electrifying night",
  "once-in-a-lifetime",
  "best in town",
  "you won't regret it",
];

export const BANNED_PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bunforgettable experience\b/gi, replacement: "great time" },
  { pattern: /\belectrifying night\b/gi, replacement: "lively night" },
  { pattern: /\bonce[- ]in[- ]a[- ]lifetime\b/gi, replacement: "special" },
  { pattern: /\bbest in town\b/gi, replacement: "local favourite" },
  { pattern: /\byou won[’']t regret it\b/gi, replacement: "" },
];

export const PREFERRED_PHRASES: string[] = [
  "pop by",
  "join us",
  "book a table",
  "we’d love to see you",
  "good food and a warm welcome",
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
