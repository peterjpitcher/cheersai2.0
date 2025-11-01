import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";

export type Platform = InstantPostInput["platforms"][number];

interface PostProcessOptions {
  body: string;
  platform: Platform;
  input: InstantPostInput;
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
}

const AM_PM_CASE = /\b(\d{1,2})(?::(\d{2}))?\s?(AM|PM)\b/g;
const ON_THE_HOUR = /\b(\d{1,2}):00\s?(am|pm)\b/gi;
const COUNTDOWN_PATTERNS: RegExp[] = [
  /\bjust\s+(?:one|1|a)\s+week(?:\s+left)?\b/gi,
  /\bonly\s+(?:one|1|a)\s+week(?:\s+left)?\b/gi,
  /\blast\s+few\s+days\b/gi,
  /\b(hurry|rush)\b[^.]*\b(ends|over)\b/gi,
  /\blast\s+chance\b/gi,
  /\bending\s+soon\b/gi,
];

const WHITESPACE = /[ \t]+/g;
const MULTI_NEWLINE = /\n{3,}/g;
const TRAILING_SPACE = /[ \t]+\n/g;
const SPACE_BEFORE_PUNCT = /\s+([,.;!?])/g;
const MULTI_SPACE = /\s{2,}/g;

function normaliseTimes(value: string): string {
  let output = value.replace(AM_PM_CASE, (_, hour: string, mins: string | undefined, suffix: string) => {
    const lowered = suffix.toLowerCase();
    if (!mins || mins === "00") {
      return `${hour}${lowered}`;
    }
    return `${hour}:${mins}${lowered}`;
  });
  output = output.replace(ON_THE_HOUR, (_, hour: string, suffix: string) => `${hour}${suffix}`);
  return output;
}

function normaliseWhitespace(value: string): string {
  return value
    .replace(WHITESPACE, " ")
    .replace(MULTI_NEWLINE, "\n\n")
    .replace(TRAILING_SPACE, "\n")
    .replace(SPACE_BEFORE_PUNCT, "$1")
    .replace(MULTI_SPACE, " ")
    .replace(/[ \t]+\./g, ".")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function parseIsoDate(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCountdownDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc d LLLL");
}

function sanitiseCountdownLanguage(
  value: string,
  scheduledFor: Date | null | undefined,
  promotionEnd: Date | null | undefined,
) {
  if (!promotionEnd) return value;
  const scheduled = scheduledFor ?? null;
  if (!scheduled) return value;

  const diffMs = promotionEnd.getTime() - scheduled.getTime();
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (Number.isNaN(diffDays) || diffDays <= 3) {
    return value;
  }

  let updated = value;
  let matched = false;
  for (const pattern of COUNTDOWN_PATTERNS) {
    if (pattern.test(updated)) {
      matched = true;
      updated = updated.replace(pattern, "");
    }
    pattern.lastIndex = 0;
  }

  if (!matched) return updated;

  const guidance = `It runs until ${formatCountdownDate(promotionEnd)}.`;
  if (!updated.toLowerCase().includes(guidance.toLowerCase())) {
    updated = `${updated.trim()} ${guidance}`.trim();
  }

  return updated.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
}

function ensureLinkInBioOnce(value: string) {
  const phrase = "See the link in our bio for details.";
  const occurrences =
    value.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))?.length ?? 0;
  if (occurrences <= 1) return value;
  let seen = 0;
  return value.replace(new RegExp(phrase, "gi"), () => {
    seen += 1;
    return seen === 1 ? phrase : "";
  });
}

export function postProcessGeneratedCopy({
  body,
  platform,
  input,
  scheduledFor,
  context,
}: PostProcessOptions): string {
  let output = body.trim();
  output = normaliseWhitespace(output);
  output = normaliseTimes(output);

  const promotionEnd = parseIsoDate(context?.promotionEnd);
  if (promotionEnd) {
    output = sanitiseCountdownLanguage(output, scheduledFor, promotionEnd);
  }

  if (platform === "instagram") {
    output = ensureLinkInBioOnce(output);
  }

  if (!input.includeHashtags && platform !== "instagram") {
    output = output.replace(/#[\p{L}\w]+/gu, "").replace(/\n{3,}/g, "\n\n");
  }

  return normaliseWhitespace(output);
}

