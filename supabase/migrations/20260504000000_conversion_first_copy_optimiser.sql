ALTER TABLE public.meta_optimisation_runs
  DROP CONSTRAINT IF EXISTS meta_optimisation_runs_mode_check;

ALTER TABLE public.meta_optimisation_runs
  ADD CONSTRAINT meta_optimisation_runs_mode_check
  CHECK (mode IN ('apply', 'dry_run', 'recommend'));

ALTER TABLE public.meta_optimisation_actions
  DROP CONSTRAINT IF EXISTS meta_optimisation_actions_action_type_check;

ALTER TABLE public.meta_optimisation_actions
  ADD COLUMN IF NOT EXISTS recommendation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS replacement_ad_id uuid REFERENCES public.ads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';

ALTER TABLE public.meta_optimisation_actions
  ADD CONSTRAINT meta_optimisation_actions_action_type_check
  CHECK (action_type IN ('pause_ad', 'tracking_issue', 'copy_rewrite'));

ALTER TABLE public.meta_optimisation_actions
  DROP CONSTRAINT IF EXISTS meta_optimisation_actions_severity_check;

ALTER TABLE public.meta_optimisation_actions
  ADD CONSTRAINT meta_optimisation_actions_severity_check
  CHECK (severity IN ('info', 'warning', 'critical'));

CREATE INDEX IF NOT EXISTS meta_optimisation_actions_replacement_ad_idx
  ON public.meta_optimisation_actions (replacement_ad_id);
