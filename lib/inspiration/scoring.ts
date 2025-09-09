export type DiversityBucket = 'civic' | 'sports' | 'food_drink' | 'seasonal'

const CATEGORY_BASE: Record<string, number> = {
  seasonal: 75,
  civic: 70,
  food: 65,
  drink: 70,
  sports: 75,
}

const SLUG_OVERRIDES: Record<string, number> = {
  'christmas-day': 98,
  'new-years-eve': 96,
  'valentines-day': 90,
  halloween: 86,
  'bonfire-night': 88,
  'pancake-day': 80,
  'mothers-day-uk': 82,
  'fathers-day-uk': 78,
  'british-food-fortnight': 82,
  'cask-ale-week': 76,
  'london-cocktail-week': 75,
  'great-british-beer-festival': 76,
  'uk-coffee-week': 72,
  'real-bread-week': 70,
  'world-gin-day': 80,
  'world-whisky-day': 78,
  'eurovision-final': 85,
  'the-open-final-weekend': 78,
  'good-friday': 74,
}

export function diversityForCategory(cat: string): DiversityBucket {
  if (cat === 'civic') return 'civic'
  if (cat === 'sports') return 'sports'
  if (cat === 'seasonal') return 'seasonal'
  // group food+drink as one bucket for diversity
  return 'food_drink'
}

function weekendUplift(dateISO: string): number {
  const d = new Date(dateISO + 'T00:00:00Z')
  const dow = d.getUTCDay() // 0 Sun .. 6 Sat
  if (dow === 5 || dow === 6) return 5 // Fri/Sat
  if (dow === 0) return 3 // Sun
  return 0
}

export function scoreOccurrence(slug: string, category: string, dateISO: string): number {
  const base = SLUG_OVERRIDES[slug] ?? CATEGORY_BASE[category] ?? 60
  const uplift = weekendUplift(dateISO)
  const score = Math.max(0, Math.min(100, base + uplift))
  return score
}
