-- COMMENTS MODERATION — Additional Tables
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS blocked_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    user_name   TEXT DEFAULT 'Unknown',
    reason      TEXT DEFAULT 'Spam/Fake comment',
    blocked_at  TIMESTAMPTZ DEFAULT now(),
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_unique ON blocked_accounts(page_id, user_id);
CREATE INDEX IF NOT EXISTS idx_blocked_page ON blocked_accounts(page_id);

CREATE TABLE IF NOT EXISTS spam_comments_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id      TEXT NOT NULL,
    post_id         TEXT,
    user_id         TEXT,
    user_name       TEXT,
    message         TEXT,
    spam_score      INT DEFAULT 0,
    matched_keywords TEXT[],
    action_taken    TEXT NOT NULL CHECK (action_taken IN ('deleted', 'hidden', 'blocked')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spam_log_date ON spam_comments_log(created_at DESC);
