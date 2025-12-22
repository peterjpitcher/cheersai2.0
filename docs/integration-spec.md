# Social Integration Specification

## 1. Overview
This document outlines platform-specific requirements, workflows, and API usage for Facebook, Instagram, and Google Business Profile (GBP) within the CheersAI rebuild.

## 2. Authentication & Token Management
- Use OAuth 2.0 flows per provider.
- Store access and refresh tokens encrypted (AES-256-GCM) in `social_connections`.
- Maintain `expires_at` timestamps; nightly job warns when <5 days remaining.
- Regenerate long-lived tokens as recommended by each API after publishing failures caused by auth errors.

## 3. Facebook
### 3.1 Supported Actions
- Page feed posts (single, carousel, video).
- Page stories (image/video, 20-second limit enforced).
- Page events (create/update with title, description, start/end, location).
- Location tagging using predefined page location ID.

### 3.2 API Endpoints / Permissions
- **Permissions**: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `pages_manage_metadata`, `pages_manage_events`.
- **Publishing**:
  - Feed post: `POST /{page-id}/photos` (for images) + `POST /{page-id}/videos` or `POST /{page-id}/feed` with `attached_media`.
  - Stories: `POST /{page-id}/stories` (requires business account; fallback to Creator Studio if unsupported).
  - Events: `POST /{page-id}/events` and `POST /{event-id}` for edits.
- **Status Check**: `GET /{page-id}/published_posts` or store response IDs and mark success immediately.

### 3.3 Constraints & Validation
- Image aspect ratio: allow 1.91:1 to 1:1; compress to <4 MB JPEG/PNG.
- Video: MP4, < 10 minutes, <1 GB recommended.
- Story content must be 1080x1920; enforce cropping/resizing before upload.
- Event creation requires location, start time, and name; CTA handled via event settings (e.g. tickets link).

### 3.4 Failure Handling
- For recoverable errors (rate limits, transient 5xx), apply backoff (5m,15m,30m).
- For auth failures, set connection status to `needs_action`, notify user.
- Provide fallback download package (copy + media) with instructions to post manually.

## 4. Instagram
### 4.1 Supported Actions
- Feed posts (single image/video, carousel up to 10 items).
- Stories (image/video up to 15 seconds; longer videos auto-split client-side prior to upload).
- Location tagging matching the connected Facebook page location.

### 4.2 API Endpoints / Permissions
- **Permissions**: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `instagram_manage_insights` (optional).
- **Publishing Flow**:
  1. Upload media container via `POST /{ig-user-id}/media` (image_url/video_url + caption + location_id).
  2. For carousel, repeat for each item with `is_carousel_item=true`.
  3. Finalise via `POST /{ig-user-id}/media_publish` referencing creation IDs.
- **Stories**: `POST /{ig-user-id}/media` with `media_type=STORIES` (if not available, revert to manual upload fallback).

### 4.3 Constraints & Validation
- Image: aspect ratios 4:5 to 1.91:1, resolution minimum 1080px shortest side.
- Video: MP4, up to 60 seconds for feed; stories 15 seconds per segment.
- Captions capped at 2,200 characters; recommended to keep <138 for readability.
- Carousel order preserved based on upload sequence.

### 4.4 Failure Handling
- Similar retry policy; if API denies stories, surface fallback manual workflow.
- Ensure refresh of tokens procedurally; if user changes password or revokes access, mark connection `needs_action`.

## 5. Google Business Profile (GBP)
### 5.1 Supported Actions
- Standard posts with CTA buttons (Call, Book, Order, etc.).
- Event posts (name, start/end time, optional link).
- Offer posts (title, redemption code, terms, start/end, CTA).
- Media attachments (single image or video per post).

### 5.2 API Endpoints / Permissions
- **Scopes**: `https://www.googleapis.com/auth/business.manage`.
- **Endpoints**:
  - Create standard post: `POST https://mybusiness.googleapis.com/v4/{name=locations/*}/localPosts`.
  - Update post: `PATCH .../localPosts/{postId}`.
  - Delete (if needed): `DELETE .../localPosts/{postId}`.
- Use latest GBP API versions; ensure location ID stored during connection.

### 5.3 Constraints & Validation
- Text limit: 1,500 characters (validate before submit).
- CTA options depend on post type; map from settings defaults.
- Image: minimum 720x720, recommended 1200x900; JPEG/PNG, <5 MB.
- Video: <30 seconds, <75 MB, resolution 720p or higher.
- Offers must include at least one of (redemption URL, coupon code, CTA).

### 5.4 Failure Handling
- On `PERMISSION_DENIED` or `NOT_FOUND`, mark connection `needs_action`.
- If content rejected (policy violation), flag `failed` with user-visible reason.
- Provide manual fallback instructions with copy and media download.

## 6. Media Processing Pipeline
- Upload via signed URL; store original.
- Background job generates derivatives per platform requirement (e.g. 1080x1920 for stories, 1080 square for IG feed).
- Use queue to perform transcoding (FFmpeg on serverless worker) to avoid blocking UI.
- Maintain metadata in `media_assets` for quick validation during publishing.

## 7. Scheduling & Queue Integration
- Each content item includes `platform` metadata to select proper adapter.
- Queue worker routes job to adapter based on provider:
  - Validate prerequisites (token status, media processed flag).
  - Execute provider publishing flow.
  - Capture `external_post_id` for audits.
- Job status transitions recorded in `publish_jobs` and bubbled to Planner view.

## 8. Testing & Sandbox Strategy
- Use provider sandboxes/test pages where available.
- Mock providers with MSW during automated tests; replay typical responses (success, rate limit, auth failure).
- Provide manual staging environment with separate FB page/IG account/GBP location for integration verification.

## 9. Monitoring & Alerts
- Log provider API latency and error codes.
- Define alert rules:
  - >3 consecutive publishing failures for same provider.
  - Token expiring within 24 hours without refresh.
  - Video transcoding failure rate >5%.
- Notify owner via email and in-app banner when alerts triggered.

## 10. Open Questions
- Confirm support for Instagram Stories publishing (API availability subject to account type); plan fallback if not.
- Decide on exact CTA defaults per GBP post type (document once settings confirmed).
- Determine whether to auto-delete stale GBP posts (offers/events) after end date or leave historical record.
