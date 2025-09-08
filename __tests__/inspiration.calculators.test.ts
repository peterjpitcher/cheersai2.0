import { easterSundayUTC, shroveTuesdayUTC, mothersDayUKUTC, toISODate } from '@/lib/inspiration/calculators'

describe('UK movable feast calculators', () => {
  test('Easter Sunday 2025 is 2025-04-20', () => {
    const d = easterSundayUTC(2025)
    expect(toISODate(d)).toBe('2025-04-20')
  })

  test('Shrove Tuesday (Pancake Day) 2025 is 2025-03-04', () => {
    const d = shroveTuesdayUTC(2025)
    expect(toISODate(d)).toBe('2025-03-04')
  })

  test('Mother’s Day (UK) 2025 is 2025-03-30', () => {
    const d = mothersDayUKUTC(2025)
    expect(toISODate(d)).toBe('2025-03-30')
  })
})

