import { scoreOccurrence, diversityForCategory } from '@/lib/inspiration/scoring'

describe('Inspiration scoring', () => {
  test('Overrides and category base apply', () => {
    expect(scoreOccurrence('christmas-day', 'seasonal', '2025-12-25')).toBeGreaterThanOrEqual(95)
    const base = scoreOccurrence('random', 'food', '2025-05-01')
    expect(base).toBeGreaterThan(60)
  })

  test('Weekend uplift increases score', () => {
    const weekday = scoreOccurrence('halloween', 'seasonal', '2025-10-29')
    const weekend = scoreOccurrence('halloween', 'seasonal', '2025-10-31') // Friday
    expect(weekend).toBeGreaterThanOrEqual(weekday)
  })

  test('Diversity bucket mapping', () => {
    expect(diversityForCategory('food')).toBe('food_drink')
    expect(diversityForCategory('drink')).toBe('food_drink')
    expect(diversityForCategory('sports')).toBe('sports')
  })
})

