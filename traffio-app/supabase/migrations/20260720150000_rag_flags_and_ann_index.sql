-- Fase 5: infraestrutura de RAG pronta, mas desligada por padrão.
begin;

insert into public.master_config (key, value, description)
values
    ('RAG_ENABLED', 'false', 'Ativa recuperação semântica da knowledge_base; desligado por padrão'),
    ('RAG_MIN_KB_ENTRIES', '20', 'Mínimo de entradas ativas por tenant para usar RAG')
on conflict (key) do nothing;

-- A migration histórica da KB já cria HNSW. Este bloco evita um índice
-- duplicado inclusive quando o índice existente tem nome gerado pelo Postgres.
do $$
begin
    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'knowledge_base'
          and indexdef ilike '%using hnsw%'
          and indexdef ilike '%embedding vector_cosine_ops%'
    ) then
        create index knowledge_base_embedding_hnsw_idx
            on public.knowledge_base using hnsw (embedding vector_cosine_ops);
    end if;
end
$$;

commit;
