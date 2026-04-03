-- =============================================================
-- RULES ENGINE FIX — Run this in Supabase SQL Editor
-- Fixes critical bugs that prevent live rules from working
-- =============================================================

-- Fix 1: Allow ALL action types including live rule types
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
  CHECK (action_type IN (
    'pause_campaign', 'enable_campaign',
    'increase_budget', 'decrease_budget', 'set_budget',
    'send_alert',
    'auto_pause_resume', 'kill_switch',
    'pause_ad', 'enable_ad',
    'pause_ad_set', 'enable_ad_set'
  ));

-- Fix 2: Make entity_id nullable for live rules (they use external IDs, not DB UUIDs)
ALTER TABLE automation_logs ALTER COLUMN entity_id DROP NOT NULL;

-- Fix 3: Allow more statuses in automation_logs (live monitor uses these)
ALTER TABLE automation_logs DROP CONSTRAINT IF EXISTS automation_logs_status_check;
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_status_check
  CHECK (status IN (
    'executed', 'failed', 'skipped_cooldown',
    'skipped_max_triggers', 'pending_approval',
    'dry_run', 'manually_overridden',
    'skipped_min_spend'
  ));

-- Fix 4: Unique constraint on active paused ads (prevent duplicates from race conditions)
DROP INDEX IF EXISTS idx_auto_paused_unique_active;
CREATE UNIQUE INDEX idx_auto_paused_unique_active
  ON automation_paused_ads(ad_external_id) WHERE is_paused = true;

-- Fix 5: Fast index for cooldown lookups on live rules
CREATE INDEX IF NOT EXISTS idx_auto_logs_entity_ext
  ON automation_logs(rule_id, entity_external_id, created_at DESC);

-- Fix 6: Add min_spend_threshold column to rules (default $1)
DO $$ BEGIN
  ALTER TABLE automation_rules ADD COLUMN min_spend_threshold NUMERIC(10,2) DEFAULT 1.00;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Done! All live rule types can now be saved and evaluated.
