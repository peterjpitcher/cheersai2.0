# API & Server Action Contracts

Draft definitions of primary server actions/endpoints. Adjust naming and payloads during implementation.

## 1. Authentication
### `POST /api/auth/login`
- Input: `{ email: string, password: string }`
- Output: `{ success: boolean, error?: string }`
- Notes: wraps Supabase auth signIn; rate-limit to prevent brute force.

### `POST /api/auth/logout`
- Input: none
- Output: `{ success: true }`

## 2. Settings
### `updateBrandProfile` (Server Action)
- Input: `{ toneFormal: number, tonePlayful: number, keyPhrases: string[], bannedTopics: string[], defaultHashtags: string[], defaultEmojis: string[], instagramSignature?: string, facebookSignature?: string, gbpCta?: string }`
- Output: `{ success: true }`

### `updatePostingDefaults`
- Manage timezone, default location IDs, notification preferences.
- Input: `{ timezone: string, facebookLocationId?: string, instagramLocationId?: string, gbpLocationId?: string, notifications: { emailFailures: boolean } }`

## 3. Media
### `createUploadUrl`
- Input: `{ mediaType: 'image' | 'video', mimeType: string }`
- Output: `{ uploadUrl: string, assetId: string }`
- Notes: returns signed URL; client uploads directly.

### `finaliseUpload`
- Input: `{ assetId: string, width?: number, height?: number, durationSeconds?: number, tags?: string[] }`
- Output: `{ success: true }`

### `GET /api/media`
- Query params: pagination, tag filters.
- Output: `{ assets: MediaAsset[] }`

## 4. Campaigns & Content
### `createCampaign`
- Input: `{ name: string, type: 'event'|'promotion'|'weekly'|'instant', startAt?: string, endAt?: string, heroMediaId?: string, metadata: Record<string, any> }`
- Output: `{ campaignId: string, contentItemIds: string[] }`
- Responsibilities: persist campaign, generate schedule slots, create content items in draft.

### `updateCampaign`
- Input: `{ campaignId: string, name?: string, startAt?: string, endAt?: string, metadata?: Record<string, any>, autoConfirm?: boolean }`

### `deleteCampaign`
- Soft delete or cascade depending on final requirement.

### `generateContentVariant`
- Input: `{ contentItemId: string, platform: 'facebook'|'instagram'|'gbp', overridePrompt?: string }`
- Output: `{ body: string, mediaIds: string[], validation: ValidationResult }`

### `updateContentVariant`
- Input: `{ variantId: string, body: string, mediaIds: string[], validation?: ValidationResult }`

### `scheduleContent`
- Input: `{ contentItemId: string, scheduledFor: string }`
- Output: `{ success: true }`
- Notes: triggers validation; inserts/updates publish job with `next_attempt_at`.

### `publishNow`
- Input: `{ contentItemId: string }`
- Output: `{ success: boolean, error?: string }`

### `GET /api/content/upcoming`
- Returns future content items for Planner view grouped by day.

## 5. Queue & Status
### `GET /api/publish/status`
- Query: `contentItemId`
- Output: `{ status: 'queued'|'in_progress'|'succeeded'|'failed', attempts: number, lastError?: string }`

### `retryPublish`
- Input: `{ contentItemId: string }`
- Output: `{ success: boolean }`
- Logic: resets publish job to `queued`, increments attempt if manual retry allowed.

### `downloadFallbackPackage`
- Input: `{ contentItemId: string }`
- Output: zipped assets + copy for manual posting.

## 6. Connections
### `POST /api/connections/{provider}/start`
- Initiates OAuth; returns redirect URL.

### `POST /api/connections/{provider}/callback`
- Handles token exchange; stores encrypted tokens, location/page IDs, expiry.

### `POST /api/connections/{provider}/disconnect`
- Revokes tokens, removes stored credentials.

### `refreshConnection`
- Background job or manual action to refresh tokens if provider supports.

## 7. Notifications
### `GET /api/notifications`
- Output: `{ notifications: Notification[], unreadCount: number }`

### `markNotificationRead`
- Input: `{ notificationId: string }`

## 8. Background Worker Interfaces
Worker functions (pseudo endpoints) invoked on schedule:
- `processDuePublishJobs()` – fetch jobs where `status='queued' and next_attempt_at <= now()`.
- `checkExpiringTokens()` – set connection status to `expiring`, create notification.
- `materialiseRecurringContent()` – generate upcoming weekly posts.

## 9. Data Contracts
### MediaAsset
```
type MediaAsset = {
  id: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  tags: string[];
  storagePath: string;
  uploadedAt: string;
};
```

### ContentItemSummary
```
type ContentItemSummary = {
  id: string;
  platform: 'facebook' | 'instagram' | 'gbp';
  scheduledFor?: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'posted' | 'failed';
  campaignId?: string;
  campaignType?: 'event' | 'promotion' | 'weekly' | 'instant';
  variant: {
    body: string;
    mediaIds: string[];
  };
  validation?: ValidationResult;
};
```

### ValidationResult
```
type ValidationResult = {
  ok: boolean;
  warnings?: string[];
  errors?: string[];
};
```

## 10. Notes
- All server actions must verify `auth.uid()` and rely on RLS; non-owner calls rejected.
- Use `@/lib/validation` Zod schemas to enforce inputs.
- Rate limit sensitive endpoints (login, regenerate AI) using in-memory or Redis store.
- Support `dryRun` query param for staging/testing posts where API call replaced with mock response.
