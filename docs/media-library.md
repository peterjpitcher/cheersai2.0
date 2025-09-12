Media Library
-------------

Overview
- Upload images to your tenant’s media library and reuse them across campaigns.
- Watermarking is now a per‑upload choice presented during the upload flow.

Watermarking
- Per‑upload: When watermark settings are enabled and a logo exists, the Watermark Adjuster opens after selecting a file. You can apply or skip for that image.
- No global toggle: The old page‑level “Apply Watermark” switch and bulk apply action have been removed.
- No batch endpoint: The API route `/api/media/batch-watermark` has been deleted.

Behaviour
- Apply: Confirms and uploads a watermarked copy using the chosen position, size, opacity, and margin.
- Skip: Closing the adjuster uploads the original image without a watermark.

Notes
- Cropping: Non‑square single uploads prompt an optional square crop before watermarking.
- Settings: Configure default watermark settings and active logo under Settings → Logo.

