-- New fields for posting defaults
ALTER TABLE posting_defaults ADD COLUMN IF NOT EXISTS default_posting_time text
  CHECK (default_posting_time IS NULL OR default_posting_time ~ '^([01]\d|2[0-3]):[0-5]\d$');
ALTER TABLE posting_defaults ADD COLUMN IF NOT EXISTS venue_location text
  CHECK (venue_location IS NULL OR length(venue_location) <= 100);
