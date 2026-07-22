-- message_inbox.status não aceitava 'failed', mas process-inbox/index.ts já
-- tentava gravar esse valor no catch de turno com erro (linha ~107) — a
-- violação do CHECK constraint era engolida pelo catch ao redor, deixando a
-- mensagem presa em 'processing' silenciosamente até o reaper (5min) resgatar.
-- Achado ao implementar a paralelização do worker (item 2 do hardening de
-- carga): mais concorrência = mais turnos passando por esse caminho de erro.
ALTER TABLE public.message_inbox DROP CONSTRAINT IF EXISTS message_inbox_status_check;
ALTER TABLE public.message_inbox ADD CONSTRAINT message_inbox_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'failed'));

SELECT 'message_inbox aceita status=failed.' AS resultado;
