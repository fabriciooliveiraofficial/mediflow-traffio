-- =============================================================================
-- MIGRAÇÃO: KYC — Adiciona restrição UNIQUE para evitar conflitos no upload
-- Data: 2026-06-18
-- =============================================================================

-- Adiciona a restrição UNIQUE para o par (order_id, document_type)
-- Isto garante a integridade dos dados e permite que operações ON CONFLICT funcionem no futuro
ALTER TABLE public.number_order_documents
ADD CONSTRAINT uq_order_document_type UNIQUE (order_id, document_type);
