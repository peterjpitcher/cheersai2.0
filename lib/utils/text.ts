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

export function enforcePlatformLimits(text: string, platform?: string): string {
  const normalised = collapseWhitespace(text)
  if (!platform) return normalised
  switch (platform) {
    case 'twitter':
      // Use Twitter-aware counting where URLs count as ~23 chars
      const max = 280
      if (twitterLength(normalised) <= max) return normalised
      // iteratively tighten to fit while keeping words
      let hi = normalised.length
      let lo = 0
      let best = normalised
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const candidate = trimToLimit(normalised, mid)
        if (twitterLength(candidate) <= max) {
          best = candidate
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return best
    default:
      return normalised
  }
}

const URL_RE = /https?:\/\/[^\s)]+/g

export function twitterLength(text: string): number {
  if (!text) return 0
  const t = collapseWhitespace(text)
  let count = 0
  let lastIndex = 0
  const urlLen = 23 // Twitter t.co canonical length (approx)
  for (const m of t.matchAll(URL_RE)) {
    const idx = m.index || 0
    // count non-url segment before url
    count += (t.slice(lastIndex, idx)).length
    // add fixed cost for this URL
    count += urlLen
    lastIndex = idx + m[0].length
  }
  // tail after last URL
  count += t.slice(lastIndex).length
  return count
}

export function platformLength(text: string, platform?: string): number {
  if (!platform || platform === 'facebook' || platform === 'instagram_business' || platform === 'google_my_business') {
    return collapseWhitespace(text).length
  }
  if (platform === 'twitter') return twitterLength(text)
  return collapseWhitespace(text).length
}
