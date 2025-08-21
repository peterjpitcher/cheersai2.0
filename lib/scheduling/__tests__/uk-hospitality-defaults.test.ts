/**
 * Tests for UK Hospitality Smart Scheduling
 */

import {
  getRecommendedSchedule,
  convertRecommendationsToSlots,
  HOSPITALITY_QUICK_PRESETS,
  UK_HOSPITALITY_SCHEDULE,
  BUSINESS_TYPES
} from '../uk-hospitality-defaults';

describe('UK Hospitality Smart Scheduling', () => {
  test('should provide recommendations for all 7 days of the week', () => {
    const schedule = getRecommendedSchedule();
    
    // Should have entries for all days (0-6)
    expect(Object.keys(schedule)).toHaveLength(7);
    expect(schedule).toHaveProperty('0'); // Sunday
    expect(schedule).toHaveProperty('6'); // Saturday
  });

  test('should have high-priority recommendations for key hospitality times', () => {
    const schedule = getRecommendedSchedule();
    
    // Check Friday (day 5) has high-priority recommendations
    const fridayRecommendations = schedule[5];
    expect(fridayRecommendations.length).toBeGreaterThan(0);
    
    // Should have high priority lunch and after-work recommendations
    const highPriorityTimes = fridayRecommendations.filter(rec => rec.priority === 'high');
    expect(highPriorityTimes.length).toBeGreaterThan(0);
  });

  test('should provide hospitality-specific quick presets', () => {
    expect(HOSPITALITY_QUICK_PRESETS).toHaveLength(5);
    
    // Check for key hospitality times
    const times = HOSPITALITY_QUICK_PRESETS.map(preset => preset.time);
    expect(times).toContain('08:00'); // Breakfast
    expect(times).toContain('12:00'); // Lunch
    expect(times).toContain('17:00'); // After work
    expect(times).toContain('19:00'); // Dinner
  });

  test('should convert recommendations to schedule slots format', () => {
    const recommendations = getRecommendedSchedule();
    const slots = convertRecommendationsToSlots(recommendations);
    
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
    
    // Check slot structure
    const firstSlot = slots[0];
    expect(firstSlot).toHaveProperty('id');
    expect(firstSlot).toHaveProperty('day_of_week');
    expect(firstSlot).toHaveProperty('time');
    expect(firstSlot).toHaveProperty('platform');
    expect(firstSlot).toHaveProperty('active');
    expect(firstSlot.active).toBe(true);
  });

  test('should filter recommendations by business type', () => {
    const pubSchedule = getRecommendedSchedule(BUSINESS_TYPES.PUB);
    const cafeSchedule = getRecommendedSchedule(BUSINESS_TYPES.CAFE);
    
    // Both should have recommendations but potentially different ones
    expect(Object.keys(pubSchedule).length).toBeGreaterThan(0);
    expect(Object.keys(cafeSchedule).length).toBeGreaterThan(0);
  });

  test('should have weekend-specific recommendations', () => {
    const schedule = getRecommendedSchedule();
    
    // Saturday (6) should have multiple recommendations for hospitality peak times
    const saturdayRecs = schedule[6];
    expect(saturdayRecs.length).toBeGreaterThan(2);
    
    // Sunday (0) should have brunch recommendations
    const sundayRecs = schedule[0];
    const brunchTime = sundayRecs.find(rec => rec.time === '10:00');
    expect(brunchTime).toBeDefined();
    expect(brunchTime?.label.toLowerCase()).toContain('brunch');
  });

  test('should provide business type constants', () => {
    expect(BUSINESS_TYPES.PUB).toBe('pub');
    expect(BUSINESS_TYPES.RESTAURANT).toBe('restaurant');
    expect(BUSINESS_TYPES.CAFE).toBe('cafe');
    expect(BUSINESS_TYPES.BAR).toBe('bar');
    expect(BUSINESS_TYPES.HOTEL).toBe('hotel');
  });
});