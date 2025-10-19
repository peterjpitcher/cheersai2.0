# Facebook Story Publish Investigation

## Context
- Page ID: `628953850871830`
- Asset ID: `496a8a29-7bf7-4f88-be1b-f28c6c39c3a7`
- Story derivative: `derived/496a8a29-7bf7-4f88-be1b-f28c6c39c3a7/story.jpg`
- Signed file URL (valid until Oct 2026):
  `https://nbkjciurhvkfpcpatbnt.supabase.co/storage/v1/object/sign/media/derived/496a8a29-7bf7-4f88-be1b-f28c6c39c3a7/story.jpg?token=…`
- Supabase function `publish-queue` (version 9) logs payload/status for story publishes.
- Access token confirmed via Graph Explorer (`GET /me/accounts`, `GET /628953850871830?fields=id,name`).

## Observations
1. Manual request:
   ```bash
   curl -X POST \
     "https://graph.facebook.com/v24.0/628953850871830/photo_stories" \
     -d "file_url=<story JPEG URL>" \
     -d "access_token=<page token>"
   ```
   returns `HTTP 500` with `{"error":{"message":"An unknown error has occurred.","type":"OAuthException","code":1}}` even though `curl -I <file_url>` returns `200 OK`.
2. Supabase logs show identical payload and response:
   ```json
   {
     "publishUrl": "https://graph.facebook.com/v24.0/628953850871830/photo_stories",
     "params": {
       "file_url": "…story.jpg?token=…",
       "access_token": "EAA…"
     },
     "status": 500,
     "body": {
       "error": {
         "message": "An unknown error has occurred.",
         "type": "OAuthException",
         "code": 1,
         "fbtrace_id": "A_J22fTsNnuU4fhAR_xObAm"
       }
     }
   }
   ```
3. Reconnecting the Page, regenerating long-lived signed URLs, uploading the asset as a native JPEG, and retrying still produce `code 1`.

## Steps to Reproduce
1. Verify media availability:
   ```bash
   curl -I "https://…story.jpg?token=…"  # returns 200 OK
   ```
2. Generate Page token (Graph Explorer → Get Page Access Token).
3. Call `/photo_stories` as shown above.
4. Observe `HTTP 500` with `OAuthException code 1`.

## Current Theory & Next Steps
- The payload and file accessibility look correct; the error is likely within Facebook’s story processing pipeline. The latest trace ID is `A_J22fTsNnuU4fhAR_xObAm`.
- Recommended action: raise a ticket with Meta Support, providing the request details, trace ID, and confirmation that the file URL is public and reachable.
