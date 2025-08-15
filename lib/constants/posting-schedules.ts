// Recommended posting schedules based on campaign type
export const RECOMMENDED_SCHEDULES = {
  event: [
    { id: "two_weeks_before", label: "2 Weeks Before", days: -14, recommended: true },
    { id: "week_before", label: "1 Week Before", days: -7, recommended: true },
    { id: "three_days_before", label: "3 Days Before", days: -3, recommended: false },
    { id: "day_before", label: "Day Before", days: -1, recommended: true },
    { id: "day_of", label: "Day Of Event", days: 0, recommended: true },
    { id: "hour_before", label: "1 Hour Before", days: 0, hours: -1, recommended: true },
  ],
  special: [
    { id: "week_before", label: "1 Week Before", days: -7, recommended: true },
    { id: "three_days_before", label: "3 Days Before", days: -3, recommended: true },
    { id: "day_before", label: "Day Before", days: -1, recommended: false },
    { id: "day_of", label: "Launch Day", days: 0, recommended: true },
    { id: "week_after", label: "1 Week After", days: 7, recommended: true },
  ],
  seasonal: [
    { id: "month_before", label: "1 Month Before", days: -30, recommended: true },
    { id: "two_weeks_before", label: "2 Weeks Before", days: -14, recommended: true },
    { id: "week_before", label: "1 Week Before", days: -7, recommended: true },
    { id: "day_of", label: "Launch Day", days: 0, recommended: true },
    { id: "week_after", label: "1 Week After", days: 7, recommended: false },
  ],
  announcement: [
    { id: "day_of", label: "Announcement Day", days: 0, recommended: true },
    { id: "day_after", label: "Day After", days: 1, recommended: true },
    { id: "week_after", label: "1 Week After", days: 7, recommended: true },
    { id: "two_weeks_after", label: "2 Weeks After", days: 14, recommended: false },
  ],
};

export type PostTiming = {
  id: string;
  label: string;
  days: number;
  hours?: number;
  recommended: boolean;
};