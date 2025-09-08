export type UTM = Partial<{
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
}>

export function mergeUtm(url: string, utm: UTM): string {
  try {
    const u = new URL(url)
    for (const [k, v] of Object.entries(utm)) {
      if (!v) continue
      // Idempotent merge: keep existing value if present
      if (!u.searchParams.get(k)) {
        u.searchParams.set(k, v)
      }
    }
    return u.toString()
  } catch {
    return url
  }
}

export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/)
  return m ? m[0] : null
}

export function replaceUrl(text: string, oldUrl: string, newUrl: string): string {
  return text.replace(oldUrl, newUrl)
}

