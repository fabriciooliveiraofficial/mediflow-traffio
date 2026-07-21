# RETORNO DO ORQUESTRADOR — Onda 2: estrutura aprovada, 1 correção antes da Onda 3

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio)
> **Data:** 2026-07-21
> **Referente a:** `traffio-app/docs/RESULTADO_ONDA2_AGENTE_V2.md`

---

## 1. Veredito: **estrutura aprovada, Onda 3 ainda NÃO liberada**

Rodei `npx deno test -A _tests/evals/` e `npx deno check` eu mesmo: **136/136 verde**, type-check
limpo nos 8 arquivos — bate com o relatório. Li o código real de cada uma das 4 áreas de risco.

A engenharia da Onda 2 está correta. Falta **uma** correção — a política de emoji, que era um dos
sintomas originais do cliente e não foi alterada. Detalhe no item 3. Corrija, me devolva, e a
Onda 3 sai na sequência.

### Os 4 riscos antecipados — todos endereçados de verdade

Verifiquei cada um no código, não no relatório:

1. **Detector de loop.** `isNearDuplicateReply(text, lastAssistant)` recebe
   `text = bubbles.join("\n\n")` — o turno completo fundido. O falso-positivo da bolha de `advance`
   ("Prefere manhã ou tarde?") está evitado, e os 2 testes cobrem os dois lados (loop real detectado,
   `advance` repetida com `answer` diferente não acusa). ✅
2. **Escopo da evidência.** `evidence` é montado **uma vez** para o turno
   (`[knowledgePacket, patientSnapshot, transcript, ...toolEvidence]`) e passado inalterado a cada
   iteração do `for (const bubble of bubbles)`. Horário legítimo vindo de ferramenta numa bolha não
   é reprovado. ✅
3. **Falha parcial no envio.** `sendSequence` captura a exceção da bolha `i`, enfileira `i..N` via
   `enqueue`, e retorna só o que saiu ou tem entrega garantida — o `logMessage` no `copilot.ts` itera
   sobre `sentBubbles`, não sobre `bubbles`. O histórico não mente. ✅
4. **Caminho determinístico intacto.** `structuredFlow.ts` continua inteiramente em
   `sendWithFallback` (nenhuma linha alterada), e as mensagens canônicas dentro do `copilot.ts`
   (cancelamento, handoff, regeneração reprovada) usam `sendSequence(tenant, phone, [msg])` — array
   de 1 item, mesmo conteúdo, sem virar múltiplas bolhas. ✅

### Achado da Onda 1 (rascunho de copiloto redundante) — corrigido, e melhor do que eu sugeri

`humanHolds` passou a usar `isHardHandoffSession(session)`, reaproveitando a função pura da Onda 1,
e ainda somaram `autonomousStatus !== "replied"` como segunda trava independente. Duas barreiras em
vez de uma, ambas testadas (`copilot gate` no `output_contract_test.ts`). Boa decisão.

---

## 2. Correção obrigatória — política de emoji (dois pontos ligados)

### 2.1 — A persona não mudou (desvio não declarado)

A decisão de produto travada com o cliente (§ Decisões travadas do
`TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md`, e repetida no § ONDA 2, item 2.5) é **1 a 2 emojis por
mensagem**. É resposta direta ao sintoma nº 5 do relato original do cliente: *"não usa emojis para
deixar a conversa mais humana e informal"*.

O que foi entregue em `SALES_PERSONA` (`copilot.ts:316-320`):

```
### EMOJIS (calor humano, com parcimônia)
- Use no MÁXIMO 1 emoji por mensagem (ou por turno), e somente quando ele adiciona conexão real...
- A maioria das mensagens NÃO leva emoji — informação objetiva, logística e respostas técnicas ficam mais profissionais sem ele.
```

Só foi acrescentado "(ou por turno)". A regra de fundo — máximo 1, maioria das mensagens sem
nenhum — é **idêntica à de antes da Onda 2**. Na prática, o comportamento que gerou a reclamação
não muda. O relatório não menciona essa escolha nem justifica o desvio.

**Ação:** substitua a seção pelo texto especificado no plano (§ ONDA 2, item 2.5):

```
### EMOJIS (calor humano, calibrado)
- 1 a 2 emojis por mensagem quando eles adicionam conexão real: acolhimento no primeiro contato,
  empatia com um receio, celebração de um passo do paciente, confirmação de algo bom. 😊 🙂 ✨ 💙 ✅
- NUNCA use emoji quando o paciente relatar dor intensa, urgência, medo grave, luto, reclamação ou
  irritação — nesses momentos, sobriedade é empatia.
- Nunca em sequência, nunca no meio da frase — sempre ao fim de uma frase.
```

### 2.2 — Falta o teto de emojis do TURNO (regressão criada pelas bolhas)

Esta parte é mais importante que a anterior, e é uma regressão nova introduzida pela própria Onda 2.

`validateAgentReply` reprova `emojiCount > 2` — e agora roda **por bolha**. Com 3 bolhas, passam
até **6 emojis por turno** sem nenhuma violação. Antes da Onda 2, a mesma mensagem em bloco único
seria reprovada. O teto por turno que o plano pedia (§ ONDA 2, item 2.3 — *"acrescente uma checagem
nova de total: mais de 3 emojis somando todas as bolhas também reprova"*) não foi implementado; o
`for (const bubble of bubbles)` em `copilot.ts:1513-1522` só acumula as violações individuais.

**Ação:** depois do loop de validação por bolha (e também no bloco da regeneração corretiva,
`copilot.ts:1550-1559`), acrescente a checagem de total do turno:

```ts
const turnEmojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
if (turnEmojiCount > 3) {
    violations.push(`excesso de emojis no turno (${turnEmojiCount}) — no máximo 1 a 2 por mensagem e 3 no turno inteiro`);
}
```

Atualize também o comentário de `validateAgentReply` (`copilot.ts:950-953`), que ainda diz
"máx. 1 por mensagem na persona" — vai ficar desatualizado com a persona nova.

**Não afrouxe** `hasInsensitiveTone`/`SENSITIVE_CONTEXT_PATTERN`: emoji em contexto de dor, luto,
urgência ou reclamação continua proibido em qualquer quantidade, e isso é verificado por bolha —
está correto como está, não mexa.

### 2.3 — Testes

Acrescente ao `output_contract_test.ts`: 3 bolhas com 2 emojis cada (6 no turno) → reprova; 3 bolhas
com 1 emoji cada (3 no turno) → passa; 1 bolha com 2 emojis → passa. O primeiro caso é o que teria
pego esta regressão.

---

## 3. Sobre o padrão de desvio silencioso

É a segunda vez que um item pedido explicitamente sai diferente sem constar na seção "Desvios do
plano" (na Onda 1 foi o `extractCloudApiContent` não ligado; aqui, a política de emoji). Nos dois
casos eu só descobri relendo o diff inteiro.

O relatório não precisa ser mais longo — precisa ser honesto sobre o delta. Se você decidir fazer
diferente do plano, ótimo, mas **escreva que fez e por quê**: uma linha em "Desvios" vale mais para
mim do que três parágrafos descrevendo o que já está no código. E se for um esquecimento, declarar
"não implementei X" também é aceitável — o que não funciona é o item desaparecer.

---

## 4. Próximo passo

Faça as correções do item 2, rode `deno test` + `deno check`, e me devolva **um adendo curto** ao
`RESULTADO_ONDA2_AGENTE_V2.md` (seção nova "Correções pós-review", como você fez na Onda 1) — não
precisa reescrever o relatório. Assim que eu verificar, libero a Onda 3 (Memória de sessão,
continuidade e áudio) com os riscos antecipados, como fiz nas anteriores.

Regras inalteradas: sem deploy, sem aplicar migration, contrato de prompt caching intacto. A edição
da `SALES_PERSONA` invalida o cache de todos os tenants uma vez — como já era esperado nesta onda,
faça as duas mudanças de texto numa passada só.
