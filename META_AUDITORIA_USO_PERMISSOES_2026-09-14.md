# Auditoria — Uso Real das Permissões Meta Aprovadas (14/09/2026)

Contexto: em 12/09/2026 a Meta aprovou os 9 escopos pendentes do app Traffio (App ID `1299722838805347`). Esta auditoria verifica, no código e na configuração real do app no Meta for Developers, se essas permissões estão de fato **em uso produtivo, completo e multi-tenant** — ou seja, se qualquer tenant que conectar sua própria conta Meta já consegue receber e responder comentários/mensagens do Facebook e Instagram sem sair da plataforma.

## Resumo executivo

| Capacidade | Status | Observação |
|---|---|---|
| Receber comentários do Facebook (Página) | ✅ Funcional | via polling (cron 1 min), multi-tenant |
| Responder comentários do Facebook (público + privado) | ✅ Funcional | UI própria, IA híbrida fora do expediente |
| Receber comentários do Instagram | ✅ Funcional | webhook + polling de segurança, multi-tenant |
| Responder comentários do Instagram (público + privado) | ✅ Funcional | UI própria, IA híbrida fora do expediente |
| Receber mensagens do Messenger (Facebook) | ✅ Funcional | webhook em tempo real, multi-tenant |
| Responder mensagens do Messenger | ✅ Funcional | fallback automático de janela 24h |
| Receber mensagens do Instagram Direct | ✅ Funcional | webhook em tempo real, multi-tenant |
| Responder mensagens do Instagram Direct | ✅ Funcional | fallback automático de janela 24h |
| `ads_read` (leitura de dados de anúncios) | ✅ Funcional | já em uso no Dashboard/relatórios |
| `instagram_business_basic` | ❌ **Não utilizável hoje** | aprovado pela Meta, mas nunca solicitado no fluxo de OAuth real |
| `instagram_business_manage_messages` | ❌ **Não utilizável hoje** | idem |
| Multi-tenant (isolamento por tenant) | ✅ Correto | webhook resolve tenant pelo page_id/ig_account_id; tokens por tenant |
| App em modo "Live"/Publicado | ✅ Confirmado | requisito para qualquer tenant externo conectar (não só testers) |

**7 das 9 permissões aprovadas já estão 100% funcionais em produção, para qualquer tenant.** As outras 2 foram aprovadas pela Meta mas não têm nenhum caminho de código que as solicite — ver achado crítico abaixo.

---

## 1. Achado crítico: 2 das 9 permissões aprovadas nunca são pedidas ao usuário

**`instagram_business_basic`** e **`instagram_business_manage_messages`** aparecem como `DEVOPS_APPROVED` / `is_live: true` na API oficial da Meta, mas **nenhuma rota de OAuth do Traffio as inclui na lista de `scope`** solicitada ao tenant.

Verifiquei o fluxo real usado em produção: o botão único "Conectar Conta Meta" no [Dashboard.tsx:471](traffio-app/src/pages/Dashboard.tsx:471) chama `handleConnect('meta', 'ads,messaging')`, que abre a função `auth-meta` ([auth-meta/index.ts:63-77](traffio-app/supabase/functions/auth-meta/index.ts:63)). A lista de escopos ali é:

```
pages_show_list, pages_messaging, instagram_manage_messages, pages_read_engagement,
pages_manage_metadata, instagram_basic, business_management, instagram_manage_comments,
pages_manage_engagement, pages_read_user_content, public_profile
```

`instagram_business_basic` e `instagram_business_manage_messages` não estão nessa lista — nem em nenhuma outra rota do código (busquei em todo o repositório).

**Por que isso não é um simples "esquecimento de uma linha":** confirmei diretamente no painel Meta for Developers (Casos de uso → API do Instagram → "Configuração da API com login do Instagram") que essas duas permissões pertencem a um produto **diferente e paralelo**: a "API do Instagram com login do Instagram" (Instagram API with Instagram Login), que tem seu **próprio App ID do Instagram** (`2037026097192674`, nome "Traffio-IG") e seu próprio fluxo de autorização — distinto do "Login do Facebook para Empresas" clássico que `auth-meta`/`auth-meta-messaging` usam hoje. Ou seja, não basta adicionar essas duas strings ao array de `scopes` existente: **é preciso implementar um segundo fluxo de OAuth**, apontando para o endpoint de login do Instagram e usando o App ID do Instagram, para que o tenant consiga de fato conceder essas permissões.

Isso também explica uma pista que já havíamos registrado durante o processo de App Review: a tela de consentimento vista nos testes (aprovação/screencasts) era genérica e sem checkboxes por permissão — provavelmente porque os screencasts dessas 2 permissões foram gravados usando a ferramenta de teste nativa desse produto Instagram Login separado, e não o fluxo `auth-meta` de produção.

**Evidência secundária de que o código espera essa permissão sem tê-la:** há um comentário fixo no [Dashboard.tsx:767](traffio-app/src/pages/Dashboard.tsx:767) — *"We use instagram_business_basic to display the connected clinic's avatar and username here"* — mas como a permissão nunca é concedida, esse dado (avatar/username do Instagram) na prática está vindo de outro lugar (provavelmente do `instagram_business_account` já embutido no retorno de `/me/accounts` da Página, que usa `instagram_basic`/token de Página, não o `instagram_business_basic` nativo). Funciona por uma via alternativa, mas o comentário no código está desalinhado com a implementação real.

**Impacto prático agora:** nenhum, porque as funcionalidades atuais de comentários e mensagens do Instagram (via Página vinculada) usam as permissões clássicas (`instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`), que **estão** corretamente solicitadas e funcionando. `instagram_business_basic`/`instagram_business_manage_messages` só importam se/quando o produto quiser suportar contas Instagram Business **sem** Página do Facebook vinculada (login direto no Instagram) — um caso de uso que hoje não existe no Traffio.

**Recomendação:** não é urgente corrigir agora, já que a operação atual (Instagram vinculado a uma Página do Facebook) cobre 100% dos tenants no modelo atual do produto. Vale registrar como item de backlog: se o produto decidir suportar contas Instagram "standalone" (sem Página do Facebook), aí sim será necessário implementar o segundo fluxo OAuth com o App ID do Instagram dedicado.

---

## 2. `auth-meta-messaging` é código órfão (achado secundário, não bloqueante)

Existe uma segunda função de OAuth, [auth-meta-messaging/index.ts](traffio-app/supabase/functions/auth-meta-messaging/index.ts), com uma lista de escopos **mais antiga e incompleta** (falta `pages_manage_engagement` e `pages_read_user_content` — necessários para comentários do Facebook). Busquei em todo o `src/` do frontend e **nenhum botão ou fluxo chama essa função** — o único botão de conexão Meta usa `auth-meta`, não `auth-meta-messaging`.

**Não é um bug ativo** (não afeta nenhum tenant hoje), mas é dívida técnica: se algum dia alguém reativar esse botão/rota pensando que está atualizado, um tenant conectado por ali ficaria sem conseguir responder comentários do Facebook. Recomendo remover o arquivo ou, se for mantido por algum motivo histórico, atualizar sua lista de escopos para ficar idêntica à de `auth-meta`.

---

## 3. Comentários (Facebook + Instagram) — auditoria funcional completa

Arquitetura simétrica entre as duas plataformas, ponta a ponta:

- **Recepção**: Instagram via webhook em tempo real (`meta-social-webhook`, campo `comments` do objeto Instagram — confirmado **"Assinado"** no painel Meta) + `sync-instagram-comments` como rede de segurança (cron 1 min, mitigação já documentada para a falha conhecida de assinatura por conta — erro #3 da Meta). Facebook via `sync-facebook-comments` (polling cron) — comentário no próprio código explica que a Meta rejeita a assinatura de webhook `comments`/`feed` no nível de Página com erro #100/#3, então polling é a solução definitiva aqui, não um workaround temporário.
- **Armazenamento**: tabelas dedicadas `instagram_comments` e `facebook_comments`, ambas com `tenant_id`, RLS por tenant, e `UNIQUE(tenant_id, comment_id)` para dedupe.
- **Resposta humana**: `reply-instagram-comment` e `reply-facebook-comment`, chamadas pela UI ([SocialCommentsInboxPanel.tsx](traffio-app/src/components/inbox/SocialCommentsInboxPanel.tsx) dentro de [HumanInboxPage.tsx](traffio-app/src/pages/HumanInboxPage.tsx)) — o atendente responde **sem sair da plataforma**, exatamente como pedido.
- **Resposta automática por IA fora do expediente**: `ai-reply-facebook-comments` / `ai-reply-instagram-comments`, publicam resposta pública + Private Reply, opt-in por tenant via `bot_config.active_agent`.
- **Multi-tenant**: cada linha de `tenant_meta_pages` guarda o `page_access_token` daquele tenant; todas as funções acima filtram por `tenant_id`/`page_id` — não há token global compartilhado.

Nenhum problema encontrado nesta área.

---

## 4. Mensagens diretas (Messenger + Instagram DM) — auditoria funcional completa

- **Recepção**: `meta-social-webhook` recebe `entry.messaging` (Messenger) e `entry.messaging`/`entry.standby` (Instagram DM). Confirmei no painel Meta que os campos `messages` e `messaging_postbacks` estão **"Assinado"** tanto no objeto Page quanto no objeto Instagram, e que a **Callback URL está corretamente configurada** como `https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/meta-social-webhook`.
- **Roteamento multi-tenant**: o webhook identifica o tenant certo consultando `tenant_meta_pages` pelo `page_id` (Facebook) ou `instagram_account_id` (Instagram) do payload recebido — cada tenant só vê as mensagens da sua própria conta conectada. Há inclusive um log específico para o caso de `is_active=false` (lição do incidente de 17/08/2026), que hoje avisa claramente por que uma mensagem não está fluindo, em vez de falhar em silêncio.
- **Handover Protocol**: implementado (`entry.standby` + `requestThreadControl`) — cobre o caso em que a Página nasce com "Page Inbox" como Primary Receiver.
- **Envio (humano e IA)**: `MetaSocialClient.sendFacebookMessage` / `sendInstagramMessage`, com fallback automático para `tag: HUMAN_AGENT` quando a janela de 24h expira (código de erro 10/200/100 tratado). Chamado por `send-human-message` (atendente, via UI) e pelo agente de IA fora do expediente.
- **Multi-tenant no envio**: `send-human-message` busca o `page_access_token` de `tenant_meta_pages` filtrando por `tenant_id` — confirmei que não há vazamento entre tenants.

**Nota menor, não bloqueante**: a busca do token em `send-human-message` usa `.limit(1)` — se um tenant conectar mais de uma Página do Facebook, sempre usa a primeira encontrada. No modelo atual (uma clínica = uma Página), isso não é um problema; vale lembrar se o produto algum dia suportar múltiplas Páginas por tenant.

---

## 5. Configurações do app / modo avançado — relação com as permissões aprovadas

Verifiquei diretamente no Meta for Developers (não apenas no código):

- **Status de publicação**: app está **"Publicado"** (badge verde em Publicar) — confirma que qualquer usuário Meta pode conceder as permissões, não apenas admins/testers do app. Requisito indispensável para operação multi-tenant real.
- **Webhooks (Configurações do app → avançado / Casos de uso → Webhooks)**: callback URL e verify token corretos; campos relevantes assinados (`messages`, `messaging_postbacks` em Page e Instagram; `comments` em Instagram). Nenhuma ação pendente aqui.
- **"Login do Facebook para Empresas" → Configurações**: existe uma "Configuração" salva chamada **"Traffio ADS"** (`config_id 1352066463474050`), mas ela **não é usada pelo código de produção** (que usa `scope=` direto no `dialog/oauth`, não `config_id=`). Isso não é um problema — o fluxo por `scope` funciona igualmente bem para as permissões clássicas — mas explica por que essa configuração salva está desatualizada/não reflete o conjunto real de permissões em uso. Não requer ação, é só uma peça órfã do painel.
- **"Ações necessárias"**: vazio, sem pendências.

Nenhuma configuração de "modo avançado" está bloqueando ou é pré-requisito faltante para as 7 permissões que já funcionam. O único pré-requisito de infraestrutura para as 2 permissões inutilizadas (`instagram_business_basic`/`instagram_business_manage_messages`) é código novo (novo fluxo OAuth), não uma configuração de painel a ativar.

---

## 6. Conclusão

Para o modelo de produto atual do Traffio (Instagram sempre vinculado a uma Página do Facebook), **as 7 permissões relevantes para comentários e mensagens já estão 100% operacionais e corretamente isoladas por tenant** — qualquer clínica que conectar sua conta Meta pelo botão "Conectar Conta Meta" já pode:
- Receber e responder comentários do Facebook e Instagram sem sair da plataforma (humano ou IA fora do expediente);
- Receber e responder mensagens do Messenger e Instagram Direct sem sair da plataforma (humano ou IA fora do expediente);
- Ter tudo isso isolado corretamente por tenant, sem vazamento entre clínicas.

As 2 permissões restantes (`instagram_business_basic`, `instagram_business_manage_messages`) estão aprovadas mas dormentes — não afetam a operação atual, e só precisam ser implementadas se o Traffio decidir suportar contas Instagram sem Página do Facebook vinculada.
