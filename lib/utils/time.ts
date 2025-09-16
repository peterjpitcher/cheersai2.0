export function toLocalYMD(date: Date | string, timeZone = 'Europe/London'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const dd = parts.find(p => p.type === 'day')?.value || ''
  const mm = parts.find(p => p.type === 'month')?.value || ''
  const yyyy = parts.find(p => p.type === 'year')?.value || ''
  return `${yyyy}-${mm}-${dd}`
}

export function hasExplicitTime(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0
}

export function formatGbDayMonth(date: Date | string, timeZone = 'Europe/London'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone })
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
