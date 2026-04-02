-- =============================================================
-- META ADS ANALYTICS — DATABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- =============================================================

CREATE TABLE IF NOT EXISTS meta_accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_account_id   TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    currency          TEXT DEFAULT 'USD',
    timezone          TEXT,
    status            TEXT DEFAULT 'active',
    is_active         BOOLEAN DEFAULT true,
    access_token      TEXT,
    token_expires_at  TIMESTAMPTZ,
    last_synced_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
    key    TEXT PRIMARY KEY,
    value  JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_settings (key, value) VALUES
    ('usd_to_inr_rate', '{"rate": 84.5, "last_updated": "2026-04-02"}'),
    ('automation_enabled', '{"enabled": true}'),
    ('default_currency', '{"currency": "USD"}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS campaigns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_account_id     UUID NOT NULL REFERENCES meta_accounts(id) ON DELETE CASCADE,
    external_id         TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'UNKNOWN',
    objective           TEXT,
    daily_budget        NUMERIC(15,2),
    lifetime_budget     NUMERIC(15,2),
    buying_type         TEXT,
    start_date          DATE,
    end_date            DATE,
    raw_data            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_sets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    external_id         TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'UNKNOWN',
    daily_budget        NUMERIC(15,2),
    lifetime_budget     NUMERIC(15,2),
    targeting_summary   TEXT,
    optimization_goal   TEXT,
    bid_strategy        TEXT,
    raw_data            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_set_id           UUID NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
    campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    external_id         TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'UNKNOWN',
    creative_type       TEXT,
    preview_url         TEXT,
    thumbnail_url       TEXT,
    raw_data            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL CHECK (entity_type IN ('campaign', 'ad_set', 'ad')),
    campaign_id         UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    ad_set_id           UUID REFERENCES ad_sets(id) ON DELETE CASCADE,
    ad_id               UUID REFERENCES ads(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    impressions         BIGINT DEFAULT 0,
    clicks              BIGINT DEFAULT 0,
    spend               NUMERIC(15,2) DEFAULT 0,
    conversions         NUMERIC(15,2) DEFAULT 0,
    conversion_value    NUMERIC(15,2) DEFAULT 0,
    reach               BIGINT,
    frequency           NUMERIC(10,4),
    video_views         BIGINT,
    link_clicks         BIGINT,
    cpc                 NUMERIC(10,4) GENERATED ALWAYS AS (
                            CASE WHEN clicks > 0 THEN spend / clicks ELSE NULL END
                        ) STORED,
    ctr                 NUMERIC(10,6) GENERATED ALWAYS AS (
                            CASE WHEN impressions > 0 THEN (clicks::NUMERIC / impressions) * 100 ELSE NULL END
                        ) STORED,
    cpm                 NUMERIC(10,4) GENERATED ALWAYS AS (
                            CASE WHEN impressions > 0 THEN (spend / impressions) * 1000 ELSE NULL END
                        ) STORED,
    roas                NUMERIC(10,4) GENERATED ALWAYS AS (
                            CASE WHEN spend > 0 THEN conversion_value / spend ELSE NULL END
                        ) STORED,
    raw_data            JSONB,
    synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_campaign_date ON metrics(campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_entity_date ON metrics(entity_type, date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique_entity_date
    ON metrics(entity_type, date,
        COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::UUID),
        COALESCE(ad_set_id, '00000000-0000-0000-0000-000000000000'::UUID),
        COALESCE(ad_id, '00000000-0000-0000-0000-000000000000'::UUID));

CREATE TABLE IF NOT EXISTS automation_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    description         TEXT,
    is_active           BOOLEAN DEFAULT true,
    scope               TEXT NOT NULL CHECK (scope IN ('campaign', 'ad_set', 'ad')),
    target_ids          UUID[],
    target_account_ids  UUID[],
    conditions          JSONB NOT NULL,
    action_type         TEXT NOT NULL CHECK (action_type IN (
                            'pause_campaign', 'enable_campaign',
                            'increase_budget', 'decrease_budget', 'set_budget',
                            'send_alert')),
    action_params       JSONB,
    cooldown_minutes    INT DEFAULT 360,
    max_triggers_per_day INT DEFAULT 2,
    requires_approval   BOOLEAN DEFAULT false,
    dry_run             BOOLEAN DEFAULT false,
    last_triggered_at   TIMESTAMPTZ,
    trigger_count       INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id             UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    rule_name           TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_id           UUID NOT NULL,
    entity_external_id  TEXT NOT NULL,
    entity_name         TEXT,
    action_type         TEXT NOT NULL,
    action_params       JSONB,
    condition_snapshot  JSONB NOT NULL,
    status              TEXT NOT NULL CHECK (status IN (
                            'executed', 'failed', 'skipped_cooldown',
                            'skipped_max_triggers', 'pending_approval',
                            'dry_run', 'manually_overridden')),
    error_message       TEXT,
    api_response        JSONB,
    previous_value      JSONB,
    is_reversed         BOOLEAN DEFAULT false,
    reversed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_logs_rule ON automation_logs(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_logs_status ON automation_logs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL CHECK (type IN (
                    'automation_fired', 'automation_failed',
                    'sync_failed', 'budget_alert',
                    'performance_alert', 'system')),
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    severity    TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    is_read     BOOLEAN DEFAULT false,
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_status (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_account_id     UUID NOT NULL REFERENCES meta_accounts(id) ON DELETE CASCADE,
    sync_type           TEXT NOT NULL CHECK (sync_type IN ('campaigns', 'metrics', 'full')),
    status              TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'partial')),
    records_processed   INT DEFAULT 0,
    error_message       TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    duration_ms         INT
);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- ROLE-BASED ACCESS CONTROL
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username          TEXT NOT NULL UNIQUE,
    display_name      TEXT,
    password_hash     TEXT NOT NULL,  -- PBKDF2-SHA256 hash
    password_salt     TEXT NOT NULL,  -- Random salt per user
    role              TEXT NOT NULL DEFAULT 'viewer'
                      CHECK (role IN ('admin', 'developer', 'viewer')),
    is_active         BOOLEAN DEFAULT true,
    last_login_at     TIMESTAMPTZ,
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active, role);

-- =============================================================
-- LIVE AD MONITORING — Auto-pause/resume tracking
-- =============================================================

CREATE TABLE IF NOT EXISTS automation_paused_ads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_external_id    TEXT NOT NULL,
    ad_name           TEXT,
    rule_id           UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
    rule_name         TEXT,
    reason            TEXT,                -- 'cpr_threshold' | 'kill_switch'
    metric_snapshot   JSONB DEFAULT '{}',  -- CPR, spend, results at time of pause
    paused_at         TIMESTAMPTZ DEFAULT now(),
    resumed_at        TIMESTAMPTZ,
    is_paused         BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_auto_paused_active ON automation_paused_ads(ad_external_id, is_paused);
CREATE INDEX IF NOT EXISTS idx_auto_paused_rule ON automation_paused_ads(rule_id, is_paused);
