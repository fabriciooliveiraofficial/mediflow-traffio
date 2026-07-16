-- GTM em Odontologia (docs/ROADMAP_PRODUTO_2026.md, item 7, 16/07/2026):
-- confirmado que 100% dos tenants atuais são odonto. Novos tenants passam a
-- nascer com Odontologia habilitada por padrão (sem precisar passar por
-- Configurações → Clínicas para ver Odontograma/Odontologia no menu).
--
-- Só afeta o DEFAULT da coluna (usado em INSERTs futuros que não
-- especificarem specialty, como o RPC register_tenant) — não altera nenhum
-- tenant existente.
ALTER TABLE public.tenants
  ALTER COLUMN specialty SET DEFAULT ARRAY['dental']::text[];
