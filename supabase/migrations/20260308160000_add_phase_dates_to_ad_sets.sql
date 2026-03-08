-- Add phase date columns to ad_sets (nullable — non-event campaigns may not use phases)
ALTER TABLE ad_sets
  ADD COLUMN IF NOT EXISTS phase_start date,
  ADD COLUMN IF NOT EXISTS phase_end   date;
