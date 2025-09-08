export type EventCategory = 'seasonal' | 'civic' | 'food' | 'drink' | 'sports'

export interface EventRecord {
  id: string
  slug: string
  name: string
  aliases: string[]
  category: EventCategory | string
  alcohol_flag: boolean
  date_type: 'fixed' | 'recurring' | 'multi_day' | string
  rrule?: string | null
  fixed_date?: string | null
  source_url?: string | null
  uk_centric: boolean
  notes?: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface EventOccurrenceRecord {
  id: string
  event_id: string
  start_date: string
  end_date: string
  country: string
  certainty: 'confirmed' | 'estimated' | string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface EventBriefRecord {
  id: string
  event_id: string
  version: number
  text: string
  constraints_applied: string[]
  drinkaware_applicable: boolean
  created_at: string
  updated_at: string
}

export interface IdeaInstanceRecord {
  id: string
  occurrence_id: string
  rank_score: number
  diversity_bucket?: string | null
  tags: string[]
  selected: boolean
  created_at: string
  updated_at: string
}

export interface UserPrefsRecord {
  id: string
  user_id: string
  show_sports: boolean
  show_alcohol: boolean
  created_at: string
  updated_at: string
}

export interface InspirationItem {
  date: string
  name: string
  category: EventCategory | string
  alcohol: boolean
  rank: number
  diversity?: string | null
  hasBrief: boolean
}

