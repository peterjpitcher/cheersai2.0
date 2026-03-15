---
title: Link in Bio
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/features
  - module/link-in-bio
related:
  - "[[Settings & Brand Voice]]"
  - "[[Schema]]"
typescript: src/lib/link-in-bio/profile.ts
---

← [[_Index]] / [[_Features MOC]]

# Link in Bio

## Overview

CheersAI provides each account with a public "link in bio" profile page hosted at `/l/{slug}`. This is a simple landing page that aggregates multiple links (booking, menu, events, etc.) for use in the Instagram bio link field.

## Data Model

**`link_in_bio_profiles`** (one per account):
- `display_name` — The venue name shown on the public page (also used as the AI venue name)
- `slug` — URL slug for the public page (`/l/{slug}`)
- `directions_url` — Google Maps or similar directions link
- `bio_text` — Short description shown on the page

**`link_in_bio_tiles`** (many per profile):
- `title` — Tile label
- `url` — Destination URL
- `icon` — Optional icon identifier
- `sort_order` — Display order
- `is_active` — Whether to show on the public page

## Public Page

`/l/{slug}` renders via `src/app/(public)/l/[slug]/page.tsx`. It is fully public (no auth required) and shows the profile's active tiles in sort order. Built with Framer Motion for smooth tile animations.

## Settings UI

The link-in-bio section is embedded within the Settings page. Components:
- `LinkInBioProfileForm` — Venue name, bio text, slug, directions URL
- `LinkInBioTileManager` — Add, reorder, activate/deactivate tiles

## Instagram Integration

When generating Instagram content, if the account has a link-in-bio URL configured, the AI prompt instructs GPT-4o to include a natural link-in-bio line (e.g. "Link in bio to book", "Check the link in our bio").
