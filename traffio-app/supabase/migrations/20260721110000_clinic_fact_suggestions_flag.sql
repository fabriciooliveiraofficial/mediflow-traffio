begin;

-- Onda 4 (blindagem do agente) — defesa em profundidade contra poisoning na
-- ingestão de conhecimento: marca (nunca bloqueia) sugestões com padrão de
-- instrução embutida, para destaque na revisão humana já obrigatória.
alter table public.clinic_fact_suggestions
    add column if not exists flagged_suspicious boolean not null default false;

commit;
