/**
 * UK Hospitality Smart Scheduling Recommendations
 * Based on industry best practices and peak engagement times
 */

export interface ScheduleRecommendation {
  time: string;
  label: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  businessTypes: string[];
  platforms: string[];
}

export interface DayRecommendations {
  [dayOfWeek: number]: ScheduleRecommendation[];
}

// UK hospitality business types
export const BUSINESS_TYPES = {
  PUB: 'pub',
  RESTAURANT: 'restaurant', 
  CAFE: 'cafe',
  BAR: 'bar',
  HOTEL: 'hotel',
  FAST_FOOD: 'fast_food',
} as const;

// Optimal posting times for UK hospitality industry
export const UK_HOSPITALITY_SCHEDULE: DayRecommendations = {
  // Sunday
  0: [
    {
      time: '10:00',
      label: 'Sunday Brunch Promotion',
      description: 'Perfect time to promote weekend brunch offers and Sunday roasts',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.HOTEL],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '14:00',
      label: 'Afternoon Leisure',
      description: 'Capture weekend diners looking for afternoon meals',
      priority: 'medium',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.RESTAURANT],
      platforms: ['facebook', 'instagram', 'all']
    }
  ],

  // Monday
  1: [
    {
      time: '08:00',
      label: 'Monday Morning Coffee',
      description: 'Target commuters and office workers starting their week',
      priority: 'medium',
      businessTypes: [BUSINESS_TYPES.CAFE, BUSINESS_TYPES.FAST_FOOD],
      platforms: ['twitter', 'linkedin', 'all']
    },
    {
      time: '17:30',
      label: 'Monday After-Work',
      description: 'Catch professionals unwinding after Monday blues',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR],
      platforms: ['facebook', 'twitter', 'all']
    }
  ],

  // Tuesday  
  2: [
    {
      time: '12:00',
      label: 'Tuesday Lunch Rush',
      description: 'Peak lunch engagement for business crowd',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.CAFE, BUSINESS_TYPES.FAST_FOOD],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '19:00',
      label: 'Midweek Dining',
      description: 'Promote special offers and quiet dining experiences',
      priority: 'medium',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.PUB],
      platforms: ['facebook', 'instagram', 'all']
    }
  ],

  // Wednesday
  3: [
    {
      time: '12:30',
      label: 'Wednesday Lunch',
      description: 'Capture hump day lunch crowd',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.CAFE, BUSINESS_TYPES.FAST_FOOD],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '18:00',
      label: 'Midweek Social',
      description: 'Perfect for quiz nights and midweek events',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR],
      platforms: ['facebook', 'twitter', 'all']
    }
  ],

  // Thursday
  4: [
    {
      time: '12:00',
      label: 'Thursday Lunch',
      description: 'Strong engagement before weekend anticipation builds',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.CAFE, BUSINESS_TYPES.FAST_FOOD],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '17:00',
      label: 'Pre-Weekend Excitement',
      description: 'Catch the Thursday night crowd - almost weekend!',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR, BUSINESS_TYPES.RESTAURANT],
      platforms: ['facebook', 'instagram', 'twitter', 'all']
    },
    {
      time: '19:30',
      label: 'Thursday Night Out',
      description: 'Prime time for promoting weekend events and specials',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR],
      platforms: ['facebook', 'instagram', 'all']
    }
  ],

  // Friday
  5: [
    {
      time: '08:30',
      label: 'Friday Morning Energy',
      description: 'Catch the TGIF mood with coffee and breakfast',
      priority: 'medium',
      businessTypes: [BUSINESS_TYPES.CAFE, BUSINESS_TYPES.FAST_FOOD],
      platforms: ['twitter', 'instagram', 'all']
    },
    {
      time: '12:00',
      label: 'Friday Lunch Celebration',
      description: 'Peak Friday lunch engagement',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.CAFE, BUSINESS_TYPES.PUB],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '17:00',
      label: 'Friday After-Work Rush',
      description: 'Prime time - everyone celebrating the weekend!',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR, BUSINESS_TYPES.RESTAURANT],
      platforms: ['facebook', 'instagram', 'twitter', 'all']
    },
    {
      time: '20:00',
      label: 'Friday Night Out',
      description: 'Peak weekend nightlife promotion time',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR, BUSINESS_TYPES.RESTAURANT],
      platforms: ['facebook', 'instagram', 'all']
    }
  ],

  // Saturday
  6: [
    {
      time: '10:00',
      label: 'Saturday Morning Leisure',
      description: 'Weekend brunch and coffee crowd',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.CAFE, BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.HOTEL],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '13:00',
      label: 'Saturday Afternoon',
      description: 'Peak weekend dining and social time',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.PUB, BUSINESS_TYPES.CAFE],
      platforms: ['facebook', 'instagram', 'all']
    },
    {
      time: '18:30',
      label: 'Saturday Evening Pre-Dinner',
      description: 'Catch people planning their Saturday night',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.RESTAURANT, BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR],
      platforms: ['facebook', 'instagram', 'twitter', 'all']
    },
    {
      time: '21:00',
      label: 'Saturday Night Entertainment',
      description: 'Prime nightlife promotion time',
      priority: 'high',
      businessTypes: [BUSINESS_TYPES.PUB, BUSINESS_TYPES.BAR],
      platforms: ['facebook', 'instagram', 'all']
    }
  ]
};

/**
 * Get recommended schedule for all days
 * Filters by business type and platform if specified
 */
export function getRecommendedSchedule(
  businessType?: string,
  platform?: string
): DayRecommendations {
  const filteredSchedule: DayRecommendations = {};

  Object.entries(UK_HOSPITALITY_SCHEDULE).forEach(([day, recommendations]) => {
    const dayNum = parseInt(day);
    filteredSchedule[dayNum] = recommendations.filter((rec: ScheduleRecommendation) => {
      const businessTypeMatch = !businessType || 
        rec.businessTypes.includes(businessType) ||
        rec.businessTypes.includes('all');
      
      const platformMatch = !platform ||
        rec.platforms.includes(platform) ||
        rec.platforms.includes('all');

      return businessTypeMatch && platformMatch;
    });
  });

  return filteredSchedule;
}

/**
 * Get top priority recommendations across all days
 */
export function getTopRecommendations(limit: number = 10): ScheduleRecommendation[] {
  const allRecommendations: ScheduleRecommendation[] = [];
  
  Object.values(UK_HOSPITALITY_SCHEDULE).forEach(dayRecommendations => {
    allRecommendations.push(...dayRecommendations);
  });

  return allRecommendations
    .filter(rec => rec.priority === 'high')
    .slice(0, limit);
}

/**
 * Convert recommendations to schedule slots format
 */
export function convertRecommendationsToSlots(
  recommendations: DayRecommendations,
  platform: string = 'all'
): Array<{ id: string; day_of_week: number; time: string; platform: string; active: boolean }> {
  const slots: Array<{ id: string; day_of_week: number; time: string; platform: string; active: boolean }> = [];

  Object.entries(recommendations).forEach(([day, recs]) => {
    const dayNum = parseInt(day);
    recs.forEach((rec: ScheduleRecommendation) => {
      slots.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? 
           crypto.randomUUID() : 
           `${dayNum}-${rec.time}-${Math.random().toString(36).slice(2)}`,
        day_of_week: dayNum,
        time: rec.time,
        platform: platform,
        active: true,
      });
    });
  });

  return slots.sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) {
      return a.day_of_week - b.day_of_week;
    }
    return a.time.localeCompare(b.time);
  });
}

/**
 * Get quick preset times for hospitality businesses
 */
export const HOSPITALITY_QUICK_PRESETS = [
  { time: '08:00', label: 'Breakfast Rush (8:00 AM)', type: 'breakfast' },
  { time: '12:00', label: 'Lunch Peak (12:00 PM)', type: 'lunch' },
  { time: '17:00', label: 'After Work (5:00 PM)', type: 'after_work' },
  { time: '19:00', label: 'Dinner Time (7:00 PM)', type: 'dinner' },
  { time: '21:00', label: 'Evening Social (9:00 PM)', type: 'evening' },
];
