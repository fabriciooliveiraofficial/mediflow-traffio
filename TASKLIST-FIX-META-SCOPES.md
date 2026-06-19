# TASKLIST: Correção de Scopes Inválidos (Meta OAuth)

## Diagnóstico do Problema
O erro `Invalid Scopes: instagram_basic` ocorre durante o redirecionamento para o Facebook OAuth porque o seu Aplicativo no painel **Meta for Developers** não reconhece essa permissão como válida. 

Os motivos exatos para isso são:
1. **Produto Ausente:** O produto **"Instagram Graph API"** não foi adicionado ao seu aplicativo no Meta. Sem esse produto, o Facebook bloqueia qualquer tentativa de solicitar os scopes `instagram_basic` e `instagram_manage_messages`.
2. **Tipo de App (Menos comum, mas possível):** Se o seu app não for do tipo "Negócios" (Business), ele pode ter restrições quanto aos scopes do Instagram.

---

## Plano de Ação

### Opção A: Correção no Painel do Meta (Recomendado para manter DM do Instagram)
*Esta opção resolve o problema pela raiz, permitindo que o Traffio gerencie as mensagens do Instagram.*

- [ ] 1. Acesse o [Meta for Developers](https://developers.facebook.com/).
- [ ] 2. Vá em **Meus Aplicativos** e selecione o aplicativo do Traffio.
- [ ] 3. No menu lateral esquerdo, clique em **"Adicionar Produto"** (Add Product) ou procure no Painel Principal.
- [ ] 4. Encontre o cartão **"Instagram Graph API"** (ou apenas "Instagram") e clique em **Configurar**.
- [ ] 5. Faça o mesmo para o produto **"Messenger"** (se já não estiver configurado), pois você também está solicitando `pages_messaging`.
- [ ] 6. Tente realizar a conexão no Traffio novamente. O erro deve sumir.

### Opção B: Correção Temporária no Código (Remover scopes do Instagram)
*Use esta opção APENAS se você não precisar das DMs do Instagram agora e quiser apenas liberar a conexão de Facebook Ads e Facebook Messenger rapidamente.*

- [x] 1. Editar o arquivo `supabase/functions/auth-meta/index.ts`.
- [x] 2. Remover `instagram_basic` e `instagram_manage_messages` do array de scopes quando a opção "messaging" é selecionada.
- [x] 3. Fazer o deploy novamente: `npx supabase functions deploy auth-meta`.

---
**Aguardando suas instruções:** 
Por favor, informe se você prefere seguir com a **Opção A** (você mesmo fará a configuração no Meta) ou com a **Opção B** (onde eu modificarei o código para remover a exigência do Instagram).
