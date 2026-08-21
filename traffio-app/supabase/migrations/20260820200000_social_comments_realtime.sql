-- Habilita Supabase Realtime para instagram_comments e facebook_comments.
-- Sem isso, o subscribe('postgres_changes') do SocialCommentsInboxPanel.tsx nunca
-- recebe eventos (silenciosamente), e a lista só é recarregada em ações manuais
-- (abrir aba, "Sincronizar agora", ou responder um comentário — que recarrega os
-- dois canais juntos, dando a falsa impressão de que Facebook só chega "de carona"
-- numa ação do Instagram).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_comments;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.facebook_comments;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END $$;
