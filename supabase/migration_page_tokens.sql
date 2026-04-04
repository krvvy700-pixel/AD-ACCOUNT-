-- =============================================
-- PAGE TOKENS TABLE — Stores page access tokens
-- for comment moderation across ALL pages
-- =============================================

CREATE TABLE IF NOT EXISTS page_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id TEXT NOT NULL UNIQUE,
  page_name TEXT,
  page_access_token TEXT NOT NULL,
  instagram_account_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by page_id
CREATE INDEX IF NOT EXISTS idx_page_tokens_page_id ON page_tokens(page_id);

-- Index for Instagram account lookups
CREATE INDEX IF NOT EXISTS idx_page_tokens_ig_account ON page_tokens(instagram_account_id) WHERE instagram_account_id IS NOT NULL;

-- Enable RLS (but allow all for now since it's server-side only)
ALTER TABLE page_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for page_tokens" ON page_tokens
  FOR ALL USING (true) WITH CHECK (true);
