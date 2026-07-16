-- Meta Cloud API como tier Pro (docs/ROADMAP_PRODUTO_2026.md, item 4, 16/07/2026):
-- billing medido de mensagens marketing/utility enviadas via Cloud API.
-- Alarga o CHECK confirmado ao vivo (tenant_usage_log_resource_type_check).
ALTER TABLE public.tenant_usage_log
  DROP CONSTRAINT tenant_usage_log_resource_type_check;

ALTER TABLE public.tenant_usage_log
  ADD CONSTRAINT tenant_usage_log_resource_type_check
  CHECK (resource_type = ANY (ARRAY[
    'call_inbound', 'call_outbound', 'sms_inbound', 'sms_outbound',
    'number_purchase', 'number_monthly',
    'whatsapp_marketing', 'whatsapp_utility'
  ]::text[]));
