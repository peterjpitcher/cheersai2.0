export interface MediaInfo {
  width?: number
  height?: number
  sizeBytes?: number
  durationSec?: number
  mimeType?: string
}

export interface MediaValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  suggestedCrops?: Array<{ aspect: string }>
}

export function validateMediaForPlatform(platform: string, media: MediaInfo): MediaValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Basic heuristics
  if (!media.width || !media.height) return { ok: true, errors: [], warnings: ['Unknown media dimensions'] }
  const aspect = media.width / media.height

  if (platform === 'instagram' || platform === 'instagram_business') {
    if (aspect < 0.8 || aspect > 1.91) {
      errors.push('Instagram recommends aspect between 4:5 and 1.91:1')
    }
    if ((media.sizeBytes || 0) > 8 * 1024 * 1024) warnings.push('Large image size may be rejected (>8MB)')
  }

  if (platform === 'facebook') {
    if (aspect < 0.5 || aspect > 2.0) warnings.push('Unusual aspect ratio for Facebook')
  }

  if (platform === 'google_my_business') {
    if (aspect < 0.9 || aspect > 1.2) warnings.push('GBP prefers near-square images (~1:1)')
  }

  const suggestedCrops = [{ aspect: '1:1' }, { aspect: '4:5' }, { aspect: '16:9' }]
  return { ok: errors.length === 0, errors, warnings, suggestedCrops }
}

