-- =============================================================================
-- MIGRAÇÃO: Add Instagram Profile Picture
-- =============================================================================

ALTER TABLE public.tenant_meta_pages
    ADD COLUMN IF NOT EXISTS instagram_profile_picture_url TEXT;
