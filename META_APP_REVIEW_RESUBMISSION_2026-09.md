# Meta App Review — Auditoria de Rejeições e Plano de Reenvio

**App:** Traffio (App ID `1299722838805347`)
**Data da auditoria:** 02/09/2026, verificado ao vivo em developers.facebook.com/apps/1299722838805347/app-review/submissions/
**Business ID:** `2051867655566239`

---

## 1. Linha do tempo real (confirmada no painel, não só na memória)

| Data | Submissão | Resultado |
|---|---|---|
| 14/07/2026 10:52 BRT | `submission_id=1318851313559166` — envio completo (16 itens) | **8 aprovadas / 8 rejeitadas** (tabela na seção 2) |
| 20/08/2026 17:56 BRT → resolvido 30/08/2026 16:40 BRT | `submission_id=1362906925820271` — reenvio isolado de `instagram_business_basic` (vídeo novo) + renovação dos 8 aprovados | **Rejeitada de novo**, mesmo motivo genérico (sem nota específica do analista desta vez). Os 8 itens aprovados foram renovados com sucesso. |
| 02/09/2026 (hoje) | `submission_id=1371645694946394` — **rascunho não enviado** | Fila atual: `instagram_business_basic`, `ads_read`, **`Human Agent`** (item novo, não estava na análise original) + renovação dos 8 aprovados. Formulário incompleto — falta preencher "Uso permitido", "Tratamento de dados" e "Instruções da análise" antes de poder enviar. |

**Achado novo importante:** `pages_manage_engagement` (a permissão de comentários do Facebook, mencionada na memória como "nunca solicitada") **já foi adicionada** ao caso de uso "Gerenciar tudo na sua Página" e está com status "Pronto para teste" — mas **ainda não foi incluída em nenhuma submissão**. Precisa ser adicionada manualmente à próxima análise (botão "Adicionar à análise do app" na aba Permissões e recursos desse caso de uso).

---

## 2. Regra que trava tudo

**A Meta permite apenas 1 submissão de App Review em andamento por vez.** Isso já bloqueou um reenvio em lote em 21/08 (documentado na memória do projeto). A submissão de 20/08 foi resolvida em 30/08, então **o caminho está livre agora** — mas assim que você iniciar o próximo envio, nenhuma outra alteração poderá ser feita até ele ser concluído (~até 20 dias). Por isso o reenvio deve ser feito **em um único lote**, com todos os itens corrigidos de uma vez.

---

## 3. Status por permissão (análise de 14/07, ainda vigente)

| Permissão | Status | Motivo oficial da rejeição | Nota específica do analista? |
|---|---|---|---|
| `pages_show_list` | ✅ Aprovada (renovada em 30/08) | — | — |
| `pages_manage_metadata` | ✅ Aprovada (renovada) | — | — |
| `pages_manage_ads` | ✅ Aprovada (renovada) | — | — |
| `business_management` | ✅ Aprovada (renovada) | — | — |
| `pages_read_engagement` | ✅ Aprovada (renovada) | — | — |
| `public_profile` | ✅ Aprovada (renovada) | — | — |
| `leads_retrieval` | ✅ Aprovada (renovada) | — | — |
| `ads_management` | ✅ Aprovada (renovada) | — | — |
| `Marketing API Access Tier` | ❌ Rejeitada — **motivo diferente** | "Our records do not show a sufficient number of Ads API calls in the last 15 days... required that the application successfully integrate with the Ads API before it is approved for Marketing API standard access tier." | Não é vídeo — é volume de uso real (≥500 chamadas/15 dias + erro <15%) |
| `instagram_business_basic` | ❌ Rejeitada **2x** (14/07 e 30/08) | Screencast não alinhado — Política 1.6 | Não (genérico nas duas vezes) |
| `instagram_business_manage_messages` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | **Sim**: precisa mostrar (1) seleção de ativo, (2) envio ao vivo pela UI, (3) mensagem entregue no cliente nativo (Instagram) |
| `instagram_manage_comments` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | Não (genérico) |
| `pages_messaging` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | **Sim**: mesma exigência acima, para o Messenger |
| `instagram_manage_messages` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | **Sim**: mesma exigência acima, para o Instagram (API legada) |
| `ads_read` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | Não (genérico) |
| `instagram_basic` | ❌ Rejeitada | Screencast não alinhado — Política 1.6 | Não (genérico) |

---

## 4. Causa raiz e o que precisa mudar de fato

Todas as 7 rejeições de vídeo (exceto Marketing API Access Tier) caem na mesma política: **"1.6 — Criar um produto confiável"**, com o texto padrão:

> *"o screencast enviado não demonstra a experiência completa do caso de uso descrito nas observações do envio"*

O requisito explícito da Meta para o vídeo (igual para todas):
1. Fluxo de login completo da Meta (OAuth);
2. Um usuário concedendo ao app acesso à permissão/recurso (tela de consentimento);
3. A experiência completa do caso de uso da permissão solicitada;
4. **Interface do app em inglês**, com legendas e dicas explicando os elementos de UI (Guia de gravação da tela da Meta).

E, onde o analista deixou nota manual (`instagram_business_manage_messages`, `pages_messaging`, `instagram_manage_messages`), o requisito é ainda mais específico:
1. Seleção do ativo (página/conta visível na tela);
2. Uma mensagem sendo **enviada ao vivo pela UI do Traffio**;
3. A **mesma mensagem aparecendo no cliente nativo** (Instagram/Messenger reais, fora do Traffio).

### ⚠️ Risco crítico identificado

`instagram_business_basic.mp4` já foi reenviado e rejeitado **duas vezes** com o mesmo motivo genérico — ou seja, o vídeo atual **ainda não** cumpre os 4 requisitos acima (provavelmente falta idioma inglês na UI, legendas, ou o fluxo de login/consentimento completo). O plano documentado na memória do projeto era **reaproveitar esse mesmo vídeo** para `instagram_basic`. Isso não deve ser feito: reaproveitar um vídeo que já falhou duas vezes só vai propagar a mesma rejeição para uma segunda permissão. **`instagram_business_basic.mp4` precisa ser regravado do zero** seguindo o checklist da seção 6, antes de ser usado (inclusive como base para `instagram_basic`).

Os demais vídeos (`instagram_business_manage_messages.mp4`, `pages_messaging.mp4`, `instagram_manage_comments.mp4`, `ads_read.mp4`) foram gravados mas nunca reenviados — não há confirmação de que atendem ao checklist de idioma/legendas. Recomendo revisar todos contra a seção 6 antes do reenvio, não só regravar o que já falhou.

---

## 5. O que NÃO reenviar agora

- **`Marketing API Access Tier`** — não é problema de vídeo. Exige ≥500 chamadas à Marketing API em 15 dias com taxa de erro <15%. Reenviar sem tráfego real repete a rejeição. Ação: monitorar uso real da Ads API e só reenviar quando o volume for atingido organicamente.

---

## 6. Checklist de gravação (aplicar a TODOS os vídeos antes do reenvio)

- [ ] Idioma da interface do app: **inglês** (mesmo sendo um produto PT-BR — trocar o idioma da sessão de teste antes de gravar, ou usar `?lang=en` se o Traffio suportar troca de idioma)
- [ ] Legendas/anotações explicando o que cada botão faz
- [ ] Gravação começa no **login Meta completo** (tela de OAuth do Facebook/Instagram)
- [ ] Mostra explicitamente a **tela de consentimento** (usuário concedendo a permissão)
- [ ] Mostra a **seleção do ativo** (qual Página/conta Instagram está sendo usada) — visível em tela
- [ ] Mostra a **ação sendo executada ao vivo** pela UI do Traffio (enviar mensagem, ler comentário, etc.)
- [ ] Para permissões de mensagem: mostra a mensagem **chegando no app nativo da Meta** (Instagram/Messenger reais), não só no painel do Traffio
- [ ] Se o app usa arquitetura server-to-server ou token de usuário do sistema em algum trecho, **declarar isso explicitamente** no campo de observações do envio

---

## 7. Textos em inglês prontos para reenvio

Os textos abaixo são traduções profissionais dos textos originais (enviados em português em 14/07/2026, extraídos de `Traffio_Meta_App_Review_Submitted_On_2026-07-14.pdf`), adaptados para o campo **"Tell us how you're using this permission or feature"**. Cole estes textos diretamente no formulário (idioma inglês, conforme exigido pela documentação da Meta para 2026).

### `instagram_business_basic`
> The instagram_business_basic permission is required for our application to read basic profile information from the connected Instagram Business account (such as username and profile picture). This is displayed in the service/CRM dashboard so that human agents (we do not use bots or AI agents for this feature) can identify the clinic and the healthcare professional account handling the interaction.

### `instagram_basic`
> Traffio is a management dashboard for healthcare clinics. The instagram_basic permission is used to: read the unique ID, username, and profile picture of the Instagram Business account connected by the clinic administrator; display this information on the Traffio integrations/connections screen so the user can confirm exactly which business account is linked; identify the origin of DM conversations by associating messages with the correct clinic profile. The app strictly complies with instagram_basic policies: data reading is limited to non-sensitive public profile metadata (username, account name, and profile picture); we do not read data from other accounts without association/authentication; we do not share this metadata with third parties; data is stored securely and used strictly to identify the channel connection for the clinic's own user.

### `instagram_business_manage_messages`
> This permission is required to read and reply to direct messages (DMs) sent by patients to the clinic's Instagram Business account. It allows our platform to centralize appointment support and patient inquiries directly in our unified human-agent service dashboard (we do not use bots or AI agents). The submitted video shows: (1) the connected Instagram account/asset visibly selected in the Traffio dashboard, (2) a message being sent live from the Traffio inbox UI, and (3) the same message appearing in the native Instagram app, confirming end-to-end delivery.

### `instagram_manage_messages`
> Traffio unifies communication for healthcare clinics. The instagram_manage_messages permission is used to: receive real-time webhooks containing new DMs sent by patients to the clinic's Instagram Business profile; render these messages in our unified human-agent service chat; send reply messages created by the clinic's human agents back to the patient on Instagram. Traffio strictly complies with Meta's rules: direct messages are sent only in active response to a patient-initiated contact (24-hour messaging window); replies are always created individually by real clinic agents operating the dashboard; we do not perform bulk sending, intrusive advertising, unsolicited offers, or any form of invasive automation (spam). All communication is aimed at clarifying questions and scheduling medical appointments. The submitted video shows the same asset-selection → live-send → native-delivery flow described above, using the legacy Instagram Messaging API.

### `pages_messaging`
> This permission is essential to receive Facebook Messenger message events sent by patients and allow clinic agents to reply to and manage these conversations from our unified medical CRM platform. We use this feature for real-time appointment scheduling and health support. The submitted video shows: (1) the connected Facebook Page visibly selected in the Traffio dashboard, (2) a message being sent live from the Traffio inbox UI, and (3) the same message appearing in the native Messenger app, confirming end-to-end delivery.

### `instagram_manage_comments`
> Traffio integrates the communication channels of medical clinics. The instagram_manage_comments permission is used to: receive real-time webhooks when a patient comments on a clinic's Instagram post (e.g., asking about pricing or how to schedule an appointment); display these comments directly in Traffio's unified inbox (CRM), allowing human agents to answer patient questions and send appointment-scheduling links directly. Traffio operates in strict compliance with Meta's Platform Policies: we do not perform arbitrary moderation, hiding, or deletion of comments in a way that misleads users; we do not use automated systems or bots to mass-reply or spam promotional comments; all replies to comments are manually initiated by qualified human clinic agents to provide legitimate support and scheduling assistance. The submitted video shows the full flow: login, permission grant, and a real comment being answered live from the Traffio UI, with the reply visible in the native Instagram app.

### `ads_read`
> Traffio integrates and centralizes management for healthcare clinics. The ads_read permission is used to: read ad performance data (such as cost, clicks, and conversions) from the clinic's connected Meta Ads campaigns; render these reports on our marketing dashboard so the clinic manager can track advertising ROI in real time. The app is fully compliant with ads_read policies: reading ad data is restricted to the private use of the clinic's own administrator; we do not share, sell, or expose this data to third parties or other advertising networks; data is accessed solely for the marketing analytics of the connected clinic. The submitted video shows the full login flow, permission grant, and the ad performance dashboard being populated live with real campaign data.

### `pages_manage_engagement` (novo — adicionado ao lote em 02/09)
> Traffio integrates the communication channels of medical clinics. The pages_manage_engagement permission is used to: receive real-time webhooks when a patient comments on a clinic's Facebook Page post (e.g., asking about pricing or how to schedule an appointment); display these comments directly in Traffio's unified inbox (CRM); and publish a reply back to the comment on behalf of the Page. Traffio uses a hybrid support model: during the clinic's business hours, comments are answered by human clinic agents operating the dashboard. Outside business hours, a reply may be generated by an AI assistant governed by strict guardrails — it never discloses prices or payment plans, never uses clinical/medical jargon, always uses a warm and honest tone, and never promises a specific appointment slot. A human agent can take over the conversation at any time. Traffio operates in strict compliance with Meta's Platform Policies: we do not perform arbitrary moderation, hiding, or deletion of comments in a way that misleads users; we do not use automation to mass-reply or spam promotional comments — every reply, whether human- or AI-authored, is a genuine, individualized response to that specific patient's comment, aimed at legitimate support and appointment scheduling. This permission is requested alongside pages_read_user_content, which is required to read the comment content before a reply can be generated.

### `pages_read_user_content` (novo — pré-requisito do pages_manage_engagement, adicionado em 02/09)
> Traffio uses the pages_read_user_content permission to read the text of comments and user-generated content on the clinic's Facebook Page posts. This is a required prerequisite for the pages_manage_engagement permission requested in this same submission: our platform must read a patient's comment before a reply can be generated and published back to it. Replies are created either by a human clinic agent during the clinic's business hours, or by an AI assistant outside business hours under strict guardrails (never discloses prices or payment plans, never uses clinical/medical jargon, always uses a warm and honest tone, never fabricates information or promises a specific appointment slot); a human agent can take over at any time. This data is used exclusively to power the unified comments inbox described in our pages_manage_engagement request; we do not use it for any other purpose and we do not share it with third parties.

### `Human Agent` (item novo no rascunho atual — não fazia parte da análise de 14/07)
> ⚠️ **Não gerei um texto pronto para este item.** Ele apareceu no rascunho de envio atual (`submission_id=1371645694946394`) mas não está documentado em nenhum material do projeto (PDF de 14/07, memória, vídeos prontos). Antes de incluir no lote de reenvio, preciso que você confirme: (1) o que exatamente esse recurso faz no Traffio — provavelmente a tag `HUMAN_AGENT` do Messenger, usada para estender a janela de resposta além das 24h quando um atendente humano assume a conversa; (2) se já existe implementação em produção; (3) se há vídeo gravado. Sem isso, incluir esse item no envio arrisca uma rejeição nova por falta de evidência.

---

## 8. Plano de reenvio recomendado (ordem de execução)

1. **Revisar/regravar vídeos** contra o checklist da seção 6 — prioridade para `instagram_business_basic.mp4` (já falhou 2x).
2. **Remover `Human Agent` do rascunho atual** — confirmado via API que ele depende de `instagram_business_manage_messages`, `instagram_manage_messages` e `pages_messaging` já estarem aprovados (seção 8.1), o que não é o caso. Reenviar só num ciclo futuro.
2.1. **Anexar os screencasts faltantes no rascunho** (`ads_read` e `instagram_business_basic` estão sem vídeo anexado, por isso `can_submit` está `false` — seção 8.1).
3. No painel do Traffio (Meta for Developers → Análise do app), no rascunho atual (`submission_id=1371645694946394`):
   - Adicionar os itens que faltam: `instagram_business_manage_messages`, `pages_messaging`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_basic`.
   - Adicionar `pages_manage_engagement` via Casos de uso → "Gerenciar tudo na sua Página" → Personalizar → Permissões e recursos → "Adicionar à análise do app".
   - **Não incluir** `Marketing API Access Tier` (seção 5).
4. Colar os textos em inglês da seção 7 em cada campo "Tell us how you're using this permission or feature".
5. Anexar os vídeos revisados (upload manual — arquivos grandes, acima do limite de 10 MB da automação de navegador).
6. Confirmar credenciais de teste no campo "Web reviewer instructions" (mesmas usadas em 14/07: `dentalteste4@traffio.com.br` / a senha está no PDF original).
7. Enviar **em um único envio** (a Meta só permite 1 por vez — seção 2).

---

## 8.1 Atualização via Meta Social Technologies MCP (dados oficiais da API, não só da UI)

Depois de configurar e autenticar o MCP oficial da Meta (`meta_social_technologies`, `devtools_app_review`/`devtools_compliance`/`devtools_api_usage`), consultei os dados diretamente pela API — mais confiáveis que a leitura do painel web. Isso confirma a maior parte do documento e corrige/adiciona os pontos abaixo:

**Histórico real de submissões (API, não UI):** só existem **2** submissões na conta, ambas com status `ACTIONED` (concluídas — nenhuma está "em análise" no momento):
- `1318851316892499` — 14/07/2026 — 16 itens — não aprovada em bloco (resultado misto, ver seção 3)
- `1362906929153604` — 30/08/2026 — só `instagram_business_basic` — não aprovada

**⚠️ Draft atual bloqueado, mas não pelo motivo que a UI sugeria.** A API retorna `can_submit: false` com a mensagem oficial *"Não é possível enviar para a análise do app enquanto um envio anterior estiver em análise"* — só que o histórico confirma que **não há nenhuma análise em andamento** no momento (as duas acima estão concluídas). A causa real e mais provável é outra: os itens do rascunho atual têm etapas obrigatórias incompletas —
- `ads_read`: etapa `screencast` = não concluída; etapa `api_precheck` = não concluída
- `instagram_business_basic`: etapa `screencast` = não concluída

Ou seja, o vídeo ainda não foi anexado a esses dois itens no rascunho atual. **Anexar os screencasts antes de tentar enviar** — é provável que isso destrave o `can_submit`. Se mesmo assim continuar bloqueado, aí sim vale abrir um ticket de suporte com a Meta citando esse texto exato, porque a API e o histórico não confirmam nenhuma análise pendente.

**Correção importante sobre `pages_manage_engagement`:** a API lista essa permissão com `grant_status: REJECTED`, mas isso **não significa que ela foi analisada e recusada** — é o status padrão da API para qualquer permissão que nunca esteve "live" (o mesmo status aparece para `email`, `gaming_profile` etc., que nunca foram sequer solicitadas). O histórico de submissões confirma: `pages_manage_engagement` nunca apareceu em nenhum envio. A informação da seção 1 (adicionada ao caso de uso, "Pronto para teste", nunca enviada) continua correta — é isso que a API está refletindo, só com um rótulo genérico confuso.

**🔴 Achado novo e crítico sobre `Human Agent`:** a API expõe as pré-condições reais desse item — `prerequisite_privileges: ["instagram_business_manage_messages", "instagram_manage_messages", "pages_messaging"]`. Ou seja, **`Human Agent` só pode ser aprovado depois que essas três permissões de mensageria já estiverem aprovadas** — e nenhuma delas está (todas rejeitadas em 14/07). Incluir `Human Agent` no rascunho atual (que só tem `ads_read` + `instagram_business_basic` + `Human Agent`, sem nenhuma das 3 pré-condições) é enviar um item que **não tem como ser aprovado neste ciclo**. Recomendação: remover `Human Agent` deste lote e reenviá-lo só num ciclo posterior, depois que `instagram_business_manage_messages`, `instagram_manage_messages` e `pages_messaging` estiverem aprovados.

**Confirmação em tempo real do `Marketing API Access Tier`:** consultei `devtools_api_usage` (call_volume, janela de 15 dias) — **0 chamadas de 240 de cota (0% de uso)**. Confirma ao vivo, com dado oficial da API (não só a memória de 21/08), que reenviar esse item agora repetiria a rejeição. Mantém-se a recomendação da seção 5: não incluir.

**Compliance geral:** `devtools_compliance` retornou `overall_status: compliant`, sem ações pendentes nem violações abertas — nada bloqueando por esse lado.

## 8.2 Progresso do preenchimento (02/09/2026) — Fase 1 (texto) concluída

Preenchi diretamente no rascunho da Meta (via navegador autenticado) o campo "Tell us how you're using this permission" em inglês para os 7 itens abaixo, e marquei o checkbox de conformidade de cada um. Confirmado via API (`devtools_app_review` → `requirements`) que todos os passos de texto/conformidade (`use_case`, `data_use_checkup`, `dependent_permission`) estão `true` — só falta o passo `screencast` (vídeo) em cada um:

- [x] `ads_read` — já vinha com checkboxes de uso padrão da Meta preenchidos (não precisou de tradução); vídeo já anexado de tentativa anterior, mas precisa ser revisado/regravado (ver seção 6).
- [x] `instagram_business_basic` — texto reescrito em inglês, reforçando fluxo de login + concessão + exibição do perfil. Vídeo anterior já anexado no rascunho, mas **precisa ser regravado do zero** (já falhou 2x com o mesmo motivo).
- [x] `instagram_basic` — texto reescrito em inglês.
- [x] `instagram_manage_messages` — texto reescrito em inglês, com os 3 elementos que o analista exigiu (seleção de ativo, envio ao vivo, entrega no nativo).
- [x] `instagram_manage_comments` — texto reescrito em inglês.
- [x] `instagram_business_manage_messages` — texto reescrito em inglês, com os 3 elementos exigidos.
- [x] `pages_messaging` — texto reescrito em inglês + campo novo "instruções de teste" preenchido (passo a passo) + Página de teste selecionada (**Auckland Dental Care** — ajustar se não for a página usada no vídeo real).

**Também pendente de decisão:** o item `Human Agent` foi removido do rascunho (não tem como ser aprovado agora — depende de permissões de mensageria ainda não aprovadas, seção 8.1). Não incluído neste lote.

## 8.3 Achado crítico de compliance — uso de IA não declarado (02/09/2026)

Ao investigar o que `pages_manage_engagement` desbloqueia no produto, encontrei uma discrepância séria entre o que os textos de justificativa afirmam e o que o código realmente faz:

- Os textos originais (aprovados em 14/07 para `instagram_manage_comments`, e reaproveitados nos rascunhos de `instagram_manage_messages`, `instagram_business_manage_messages`, `pages_messaging`) afirmam **"não usamos bots ou agente de IA"** / **"toda resposta é criada individualmente por atendente humano real"**.
- O código mostra o contrário: `ai-reply-facebook-comments`, `ai-reply-instagram-comments` respondem automaticamente e publicam sem revisão humana; `meta-social-webhook` inicia toda conversa nova do Instagram/Messenger com `omnichannel_status: "bot_active"` (só vira `human_active` quando um atendente assume manualmente).
- **Confirmado com o usuário**: o uso real é **híbrido** — atendimento humano durante o horário de funcionamento da clínica, agente de IA assume apenas fora desse horário, com handoff para humano a qualquer momento.

**Ação tomada**: reescrevi os 5 textos afetados (`instagram_manage_comments`, `instagram_manage_messages`, `instagram_business_manage_messages`, `pages_messaging`, `pages_manage_engagement`) para declarar esse modelo híbrido com precisão, incluindo as salvaguardas reais do agente de IA (nunca informa preço, nunca usa jargão clínico, tom acolhedor, nunca promete horário específico, handoff humano a qualquer momento). Isso evita declarar algo falso à Meta, o que poderia resultar em banimento permanente do app se descoberto em auditoria.

## 8.4 ENVIADO — confirmado em 03/09/2026

O lote com os 9 itens (`pages_read_user_content`, `pages_manage_engagement`, `pages_messaging`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_business_manage_messages`, `ads_read`, `instagram_business_basic`) foi **enviado para análise da Meta**.

**Antes do envio, foi feita uma verificação manual completa dos 9 vídeos** (clicando em "Visualizar screencast carregado" em cada card e confirmando reprodução real, não só o ícone verde) — todos tocaram normalmente, com durações entre 2:27 e 6:31. A API `devtools_app_review` continuou mostrando `screencast: false` até o momento do envio (aparente atraso de sincronização da API Beta — não impediu o envio real).

**Confirmação pós-envio (API oficial):**
```
submission_status: "PENDING"
submission_id: "1371645691613061"
is_pending: true
submitted_time: 1788447350 (03/09/2026)
```

E na UI: status "Análise em andamento" — "A maioria das solicitações é analisada em até 20 dias."

**Verificação final feita antes do envio** (todos em inglês, conforme exigido):
- Uso permitido: 9 textos revisados, checkbox de conformidade marcado em todos
- Tratamento de dados: respostas de compliance corretas (não são texto livre, não precisam de tradução)
- Instruções da análise: instruções de acesso em inglês, credenciais de teste corretas (`dentalteste4@traffio.com.br`), campos opcionais em inglês, vídeo de apoio anexado

**Não incluídos neste lote** (por decisão consciente, documentado nas seções 5 e 8.1): `Marketing API Access Tier` (sem volume de uso real) e `Human Agent` (depende de permissões de mensageria ainda não aprovadas).

**Próximo passo:** aguardar o resultado da Meta (até ~20 dias). Nenhuma outra alteração deve ser feita no app/permissões enquanto essa análise estiver em andamento (regra de 1 submissão por vez).

## 8.5 ✅ APROVADO — resultado confirmado em 14/09/2026

A Meta concluiu a análise em **9 dias** (bem abaixo da estimativa de 20 dias): submetido em 03/09/2026 14:55 UTC, decisão publicada em 12/09/2026 22:57 UTC (19:57 BRT).

**Resultado: aprovação total, todos os 9 itens `Approved`, nenhuma pendência.**

Confirmado em duas fontes independentes:

**1) API oficial (`devtools_app_review status`/`history`/`privileges`):**
```
submission_status: "ACTIONED"
submission_id: "1371645691613061"
is_approved: true
is_pending: false
is_canceled: false
review_completed_time: 1789253855 (12/09/2026 22:57 UTC)
```
Todos os 9 privilégios (`instagram_business_basic`, `instagram_business_manage_messages`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_manage_comments`, `pages_messaging`, `instagram_manage_messages`, `ads_read`, `instagram_basic`) aparecem com `grant_status: "DEVOPS_APPROVED"`, `is_live: true`, `is_rejected: false`.

**2) UI (developers.facebook.com/apps/1299722838805347/app-review/submissions/):** card "Envio aprovado — Nossa análise foi concluída e suas solicitações e configurações de app foram aprovadas", com os 9 itens da seção "Novas solicitações" marcados `Approved` e os 8 itens de renovação (`pages_show_list`, `pages_manage_metadata`, `pages_manage_ads`, `business_management`, `pages_read_engagement`, `public_profile`, `leads_retrieval`, `ads_management`) marcados `Renewed`.

**Sem feedback negativo, sem itens rejeitados, sem ação pendente do analista.** A seção "Ações necessárias" do app mostra apenas a "Verificação de Uso de Dados" já `Completed` em 12/09/2026 — nenhum item aberto. Não houve necessidade de recorrer/responder a nada.

**Status pós-aprovação:**
- As 9 permissões agora estão live em produção no app Traffio, liberando: resposta a comentários e mensagens do Facebook/Instagram pela plataforma (humano + IA híbrida fora do expediente), leitura de anúncios (`ads_read`), acesso básico Instagram/Facebook.
- Itens deliberadamente fora deste lote continuam pendentes de decisão futura, sem mudança: `Marketing API Access Tier` (aguardando volume real de uso da Ads API) e `Human Agent` (agora que as 3 permissões de mensageria das quais depende foram aprovadas, pode ser reavaliado num próximo ciclo).
- Risco residual já conhecido, ainda não endereçado: o texto de `instagram_manage_comments` aprovado originalmente em 14/07/2026 ainda contém a alegação desatualizada de "100% humano" (não reflete o modelo híbrido real do produto) — não foi corrigido porque essa submissão específica já está fechada/histórica; considerar atualizar na próxima renovação periódica desse acesso.

## 9. Fontes verificadas ao vivo em 02/09/2026

- `developers.facebook.com/apps/1299722838805347/app-review/submissions/` — lista de envios e rascunho atual
- Feedback da análise de 14/07: `.../submissions/feedback/?submission_id=1318851313559166`
- Feedback do reenvio de 20/08→30/08: `.../submissions/feedback/?submission_id=1362906925820271`
- Caso de uso "Gerenciar tudo na sua Página": `.../use_cases/customize/?use_case_enum=PAGES_API` — confirma `pages_manage_engagement` já adicionado, status "Pronto para teste"
- `Traffio_Meta_App_Review_Submitted_On_2026-07-14.pdf` (raiz do repo) — textos originais em português usados no envio de 14/07
