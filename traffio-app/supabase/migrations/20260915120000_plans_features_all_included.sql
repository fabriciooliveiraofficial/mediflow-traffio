-- Decisão de produto (15/09/2026): os planos não bloqueiam recursos de software
-- (custo marginal zero). O que diferencia é conversas de IA incluídas,
-- profissionais/unidades, armazenamento e números de WhatsApp.
-- Espelho de src/config/planConfig.ts e src/config/planComparison.ts.
UPDATE public.plans
   SET features = features || '{
        "whatsapp_inbox": true, "whatsapp_midia": true, "cloud_api": true,
        "crm_kanban": true, "marketing_ads": true, "financeiro_completo": true,
        "modulos_especialidade": -1, "dicom": true, "ia_termos_clinicos": true
   }'::jsonb
 WHERE id = 'essencial';

UPDATE public.plans
   SET features = features || '{"cloud_api": true}'::jsonb
 WHERE id IN ('clinica', 'rede');
