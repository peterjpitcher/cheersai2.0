---
title: Settings & Brand Voice
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/features
  - module/settings
route: /settings
related:
  - "[[Content Creation & Campaigns]]"
  - "[[Link in Bio]]"
  - "[[Schema]]"
typescript: src/lib/settings/data.ts
---

← [[_Index]] / [[_Features MOC]]

# Settings & Brand Voice

## Overview

The Settings page allows pub operators to configure how CheersAI generates content for them. It covers brand voice (for AI content generation) and posting defaults (platform-specific preferences).

## Brand Profile (`brand_profile` table)

| Setting | Type | Purpose |
|---------|------|---------|
| `toneFormal` | 0.0–1.0 | Formality slider. <0.3 = very casual, >0.7 = formal |
| `tonePlayful` | 0.0–1.0 | Playfulness slider. <0.3 = straightforward, >0.7 = playful |
| `keyPhrases` | string[] | Phrases to weave in naturally if appropriate |
| `bannedTopics` | string[] | Topics the AI must not mention |
| `bannedPhrases` | string[] | Specific phrases to avoid (merged with system-level bans from `src/lib/ai/voice.ts`) |
| `defaultHashtags` | string[] | Hashtags included when hashtag mode is enabled |
| `defaultEmojis` | string[] | Preferred emojis for emoji mode |
| `facebookSignature` | text | Verbatim signature appended to Facebook posts |
| `instagramSignature` | text | Verbatim signature appended to Instagram posts |
| `gbpCta` | text | Default CTA action type for GBP posts (e.g. `LEARN_MORE`, `BOOK`) |

## Posting Defaults (`posting_defaults` table)

| Setting | Purpose |
|---------|---------|
| `notifications.emailFailures` | Email alert when a post fails to publish |
| `notifications.emailTokenExpiring` | Email alert when a platform token is near expiry |
| `gbpCtaDefaults.standard` | GBP CTA for standard posts |
| `gbpCtaDefaults.event` | GBP CTA for event posts |
| `gbpCtaDefaults.offer` | GBP CTA for offer/promotion posts |
| `facebookLocationId` | Facebook location tag ID |
| `instagramLocationId` | Instagram location tag ID |
| `gbpLocationId` | GBP location ID (secondary to `social_connections.metadata.locationId`) |

## Venue Name

The venue name used in AI prompts is resolved from:
1. `link_in_bio_profiles.display_name` (priority)
2. `accounts.display_name` (fallback)

This allows the pub's public-facing name to drive the AI content, so it doesn't need to be set separately in brand settings.

## Management App Prefill

`src/lib/management-app/` provides an integration with an external management application (The Anchor's management system). If configured, brand voice and venue name may be pre-populated from the management app via `getManagementAppData()`.

## Components

| Component | File | Purpose |
|-----------|------|---------|
| `BrandVoiceForm` | `src/features/settings/brand-voice-form.tsx` | Tone sliders, key phrases, bans, hashtags |
| `PostingDefaultsForm` | `src/features/settings/posting-defaults-form.tsx` | Notification prefs, GBP CTA defaults |
| `ManagementConnectionForm` | `src/features/settings/management-connection-form.tsx` | Link to management app |
| `LinkInBioSettingsSection` | `src/features/settings/link-in-bio/link-in-bio-settings-section.tsx` | Link-in-bio profile settings |
