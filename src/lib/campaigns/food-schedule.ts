import type { FoodServiceHours, FoodServiceKey, FoodDecisionStage, RunDay } from '@/types/campaigns';

export const DEFAULT_FOOD_SERVICE_HOURS: Record<FoodServiceKey, FoodServiceHours> = {
  weekday_dinner: {
    serviceKey: 'weekday_dinner', enabled: true,
    days: ['tuesday', 'wednesday', 'thursday', 'friday'],
    startLocal: '16:00', endLocal: '21:00', lastOrdersLocal: '20:30',
  },
  saturday_food: {
    serviceKey: 'saturday_food', enabled: true,
    days: ['saturday'], startLocal: '12:00', endLocal: '19:00', lastOrdersLocal: '18:30',
  },
  sunday_roast: {
    serviceKey: 'sunday_roast', enabled: true,
    days: ['sunday'], startLocal: '13:00', endLocal: '18:00', lastOrdersLocal: '17:30',
  },
};

export interface DecisionStageTemplate {
  windowKey: string;
  decisionStage: FoodDecisionStage;
  serviceDateOffsetDays: number;   // serviceDate − runDate
  startLocal: string;
  endLocal: string;
  weight: number;
  copyIntent: string;
  defaultEnabled: boolean;
}

export const DECISION_STAGE_TEMPLATES: Record<FoodServiceKey, DecisionStageTemplate[]> = {
  weekday_dinner: [
    { windowKey: 'weekday_lunch_decision', decisionStage: 'lunch_decision', serviceDateOffsetDays: 0, startLocal: '11:00', endLocal: '13:30', weight: 55, copyIntent: "Get tonight's dinner decided during the lunch break.", defaultEnabled: true },
    { windowKey: 'weekday_afternoon_commit', decisionStage: 'afternoon_commit', serviceDateOffsetDays: 0, startLocal: '15:00', endLocal: '17:15', weight: 35, copyIntent: 'Finalise after-work plans; book a table before heading home.', defaultEnabled: true },
    { windowKey: 'weekday_last_minute', decisionStage: 'last_minute', serviceDateOffsetDays: 0, startLocal: '17:15', endLocal: '18:30', weight: 10, copyIntent: 'Low-weight rescue: still deciding dinner? Book for this evening.', defaultEnabled: false },
  ],
  saturday_food: [
    { windowKey: 'saturday_planning', decisionStage: 'planning', serviceDateOffsetDays: 1, startLocal: '16:00', endLocal: '20:00', weight: 25, copyIntent: 'Plan Saturday lunch or early dinner.', defaultEnabled: true },
    { windowKey: 'saturday_lunch_commit', decisionStage: 'lunch_decision', serviceDateOffsetDays: 0, startLocal: '08:30', endLocal: '11:30', weight: 35, copyIntent: 'Book lunch from 12pm.', defaultEnabled: true },
    { windowKey: 'saturday_afternoon_food', decisionStage: 'afternoon_commit', serviceDateOffsetDays: 0, startLocal: '12:30', endLocal: '16:30', weight: 30, copyIntent: 'Tables for food until 7pm.', defaultEnabled: true },
    { windowKey: 'saturday_final_nudge', decisionStage: 'last_minute', serviceDateOffsetDays: 0, startLocal: '16:30', endLocal: '17:30', weight: 10, copyIntent: 'Low-weight late demand: still time to book early dinner.', defaultEnabled: false },
  ],
  sunday_roast: [
    { windowKey: 'sunday_roast_planning', decisionStage: 'planning', serviceDateOffsetDays: 2, startLocal: '09:00', endLocal: '14:00', weight: 20, copyIntent: 'Book Sunday roast for this weekend.', defaultEnabled: true },
    { windowKey: 'sunday_roast_tomorrow', decisionStage: 'tomorrow', serviceDateOffsetDays: 1, startLocal: '09:00', endLocal: '18:00', weight: 35, copyIntent: 'Sunday roast tomorrow — reserve your table.', defaultEnabled: true },
    { windowKey: 'sunday_roast_morning', decisionStage: 'morning_commit', serviceDateOffsetDays: 0, startLocal: '08:30', endLocal: '11:30', weight: 30, copyIntent: 'Roasts served from 1pm today.', defaultEnabled: true },
    { windowKey: 'sunday_roast_last_tables', decisionStage: 'last_tables', serviceDateOffsetDays: 0, startLocal: '11:30', endLocal: '16:00', weight: 15, copyIntent: 'Last orders 5:30pm — book your table for Sunday roast.', defaultEnabled: true },
  ],
};

export const SERVICE_BUDGET_GUIDANCE: Record<FoodServiceKey, number> = {
  sunday_roast: 50, weekday_dinner: 35, saturday_food: 15,
};

const HARD_STOPS: Record<FoodServiceKey, { default: string; friday?: string }> = {
  weekday_dinner: { default: '18:30', friday: '19:00' },
  saturday_food: { default: '17:30' },
  sunday_roast: { default: '16:30' },
};

export function hardStopFor(serviceKey: FoodServiceKey, runDay: RunDay): string {
  const stop = HARD_STOPS[serviceKey];
  if (serviceKey === 'weekday_dinner' && runDay === 'friday' && stop.friday) return stop.friday;
  return stop.default;
}

export function lastOrdersOrDefault(hours: FoodServiceHours): string {
  if (hours.lastOrdersLocal) return hours.lastOrdersLocal;
  const [h, m] = hours.endLocal.split(':').map(Number);
  // Wrap into a valid time-of-day [0, 1440). A service ending at/just after midnight would
  // otherwise underflow to a negative, invalid "HH:MM" (e.g. 00:15 → "-1:-15"); 30 min
  // before close then sensibly lands on the previous evening (00:15 → 23:45).
  const total = (((h * 60 + m - 30) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
