export type PreflightLevel = 'pass' | 'warn' | 'fail'

export interface PreflightFinding { level: PreflightLevel; code: string; message: string }
export interface PreflightResult { overall: PreflightLevel; findings: PreflightFinding[] }

const DEFAULT_BANNED = [
  /free\s+gift\s*card/i,
  /click\s+here/i,
]
export function preflight(content: string, platform: string, options?: { banned?: RegExp[] }): PreflightResult {
  const findings: PreflightFinding[] = []
  const banned = options?.banned || DEFAULT_BANNED
  const text = content || ''

  // banned phrases
  for (const re of banned) {
    if (re.test(text)) findings.push({ level: 'fail', code: 'banned_phrase', message: `Contains banned phrase: ${re.source}` })
  }
  // excessive caps
  if (/(?:\b[A-Z]{5,}\b)/.test(text)) findings.push({ level: 'warn', code: 'caps', message: 'Excessive capitalisation detected' })
  // emoji spam
  if (/(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]{4,})/u.test(text)) findings.push({ level: 'warn', code: 'emoji_spam', message: 'Too many emoji in a row' })
  // link count
  const links = text.match(/https?:\/\/[^\s)]+/g) || []
  if (links.length > 2) findings.push({ level: 'warn', code: 'too_many_links', message: 'Too many links for social platforms' })

  // platform constraints
  if (platform === 'instagram_business' && links.length > 0) findings.push({ level: 'warn', code: 'instagram_links', message: 'Instagram captions don’t support clickable links' })

  const overall: PreflightLevel = findings.some(f => f.level === 'fail') ? 'fail' : (findings.some(f => f.level === 'warn') ? 'warn' : 'pass')
  return { overall, findings }
}
