export function collapseWhitespace(text: string): string {
  return (text || '')
    .replace(/[ \t\f\v\u00A0\u2000-\u200B]+/g, ' ') // collapse spaces
    .replace(/\s*\n\s*/g, '\n') // trim around newlines
    .replace(/\n{3,}/g, '\n\n') // max 2 consecutive newlines
    .trim()
}

export function trimToLimit(text: string, limit: number): string {
  if (!text) return text
  if (text.length <= limit) return text
  const soft = text.slice(0, Math.max(0, limit - 1))
  // avoid cutting mid-word
  let cut = soft.replace(/\s+\S*$/, '')
  if (!cut || cut.length < limit * 0.6) {
    // fallback to hard cut if a single long token
    cut = soft
  }
  // remove trailing punctuation
  cut = cut.replace(/[\s.,;:!\-]+$/, '')
  return cut + '…'
}

const PLATFORM_LIMITS: Record<string, number> = {
  linkedin: 3000,
  linkedin_page: 3000,
  instagram: 2200,
  instagram_business: 2200,
  google_my_business: 1500,
}

export function enforcePlatformLimits(text: string, platform?: string): string {
  const normalised = collapseWhitespace(text)
  if (!platform) return normalised
  const key = platform.toLowerCase()
  const limit = PLATFORM_LIMITS[key]
  if (!limit) return normalised
  if (normalised.length <= limit) return normalised
  return trimToLimit(normalised, limit)
}

export function platformLength(text: string, platform?: string): number {
  if (!platform || platform === 'facebook' || platform === 'instagram_business' || platform === 'google_my_business') {
    return collapseWhitespace(text).length
  }
  return collapseWhitespace(text).length
}
