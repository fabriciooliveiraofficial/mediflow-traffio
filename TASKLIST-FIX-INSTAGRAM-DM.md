# TASKLIST: Restauração Definitiva do Instagram DM (Fase Final)

## 🔍 Diagnóstico Preciso e Cirúrgico
Você realizou a reconexão com sucesso e ativou a assinatura para "Page" (Página) no painel de Webhooks da Meta. Isso habilitou o recebimento de mensagens do **Facebook Messenger**.
No entanto, a arquitetura da Meta separa os eventos de mensagens. Para que as **DMs do Instagram** sejam enviadas para o nosso sistema, é obrigatório configurar a URL de Callback também no tópico específico de **"Instagram"** dentro do painel de Webhooks. Sem essa configuração, a Meta ignora as DMs e não dispara o webhook.

## 📋 Plano de Ação

### Fase 4: Configuração do Tópico "Instagram" no Meta (Será feito por você)
- [ ] 1. Acesse o painel do seu app no **Meta for Developers**.
- [ ] 2. No menu lateral esquerdo, vá em **Webhooks**.
- [ ] 3. No menu dropdown no topo da página, mude de "Page" (Página) para **"Instagram"**.
- [ ] 4. Clique em **"Edit Subscription"** (ou "Subscribe to this object").
- [ ] 5. Insira a mesma URL de Callback e o mesmo Token de Verificação (Verify Token) que você usou para o Facebook.
- [ ] 6. Inscreva-se nos eventos **`messages`** e **`messaging_postbacks`**.
- [ ] 7. Salve as configurações.

### Fase 5: Validação do Fluxo Completo (Será feito por você)
- [ ] 8. Envie uma nova mensagem para o Direct do Instagram conectado.
- [ ] 9. (Opcional) Envie uma mensagem para a Página do Facebook conectada.
- [ ] 10. Verifique na página **Atendimento** se as mensagens apareceram.

---

### 🗄️ Scripts de Diagnóstico (SQL Editor)
Sempre execute esses scripts após o teste prático (passos 8 a 10) para confirmarmos tecnicamente se a Meta disparou o evento.

```sql
-- 1. Verificar se a mensagem chegou na Fila de Processamento (Inbox)
-- Se a mensagem aparecer aqui, o Webhook da Meta funcionou com sucesso!
SELECT id, tenant_id, phone as sender_id, left(content, 50) as content, status, created_at 
FROM message_inbox 
ORDER BY created_at DESC LIMIT 5;

-- 2. Verificar se a Sessão da Conversa foi criada/atualizada para o usuário
SELECT id, patient_phone as sender_id, channel, omnichannel_status, platform_user_id 
FROM conversation_sessions 
WHERE channel IN ('instagram', 'facebook') 
ORDER BY updated_at DESC LIMIT 5;

-- 3. Verificar se a mensagem final foi para o chat do paciente
-- (Garante que o cron job "process-inbox" processou a fila corretamente)
SELECT id, session_id, role, left(content, 50) as content, created_at
FROM patient_messages
ORDER BY created_at DESC LIMIT 5;
```
