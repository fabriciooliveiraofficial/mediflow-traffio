# Resultado — Camada de Conhecimento do Agente

Data: 2026-07-17  
Escopo executado: Fase 1 (A1, A2 e A3) até o gate obrigatório.  
Estado honesto: a implementação determinística da Fase 1 está pronta, mas o gate de eval conversacional não foi concluído porque `ANTHROPIC_API_KEY` não existe no ambiente. Conforme a tarefa, as Fases 2–5 não foram iniciadas e nenhuma migration foi aplicada.

## Fase 1 — fundação

### A1 — catálogo canônico

Foi criado [`src/config/clinicFactsSchema.ts`](../src/config/clinicFactsSchema.ts), sem dependências de React/Supabase. Cada fato tem chave estável, categoria persistida compatível com `clinic_info`, seção de UI, tipo, texto em `pt-BR`/`en`/`es`, ajuda, exemplo e opções quando necessário.

| Seção | Chaves (categoria persistida / tipo) |
|---|---|
| Comercial | `consultation_fee` (policies/enum), `first_consultation_process` (faq/long), `payment_methods` (policies/short), `installment_options` (policies/short), `accepted_insurance` (policies/long), `written_estimate` (policies/boolean) |
| Logística | `address` (logistics/long), `parking` (logistics/short), `accessibility` (amenities/short), `public_transport` (logistics/short), `business_hours` (logistics/long), `languages_spoken` (amenities/short), `contact_channels` (logistics/short) |
| Clínico-operacional | `dental_anxiety_support` (faq/long), `sedation_availability` (faq/enum), `children_served` (faq/boolean), `children_minimum_age` (faq/short), `urgent_appointments` (faq/enum), `evaluation_includes_xray` (faq/enum), `first_visit_documents` (faq/long) |
| Políticas | `cancellation_policy` (policies/long), `late_arrival_tolerance` (policies/short), `rescheduling_policy` (policies/long), `appointment_confirmation` (policies/long), `companion_policy` (policies/short) |

São 25 fatos. `calculateClinicFactsCompletion` conta somente chaves do catálogo com valor não vazio e ativas; fatos customizados, inativos e whitespace não contam. Os limites são 5 caracteres para boolean, 64 para enum, 240 para texto curto e 1.200 para texto longo.

### A2 — UI guiada

Foi criado [`src/components/settings/ClinicKnowledgeSettings.tsx`](../src/components/settings/ClinicKnowledgeSettings.tsx) e integrado em [`src/pages/Settings.tsx`](../src/pages/Settings.tsx). A aba só aparece para `action:edit_config` e o componente também exige `owner`/`admin`; usa exclusivamente `currentTenant.id`.

Layout lógico:

```text
Configurações
└── Base de Conhecimento da IA [Ficha canônica]
    ├── Completude: 0 de 25 fatos ──────────────── 0%
    ├── Comercial e conversão
    │   └── cards: label + ajuda + exemplo + campo + [vazio/preenchido] + Salvar
    ├── Logística e acesso
    ├── Atendimento clínico (sem diagnóstico)
    └── Políticas da clínica
```

Booleanos são tri-state (`Não informado`, `Sim`, `Não`); enums são selects; textos curtos são inputs e textos longos são textareas com contador. Cada card salva individualmente, mostra toast/erro, desabilita o campo durante a gravação e remove a linha existente quando o usuário salva vazio. A carga usa um request-id e ignora resposta obsoleta ao trocar de tenant.

As três traduções de chrome da UI estão em `src/locales/{pt-BR,en,es}/settings.json`. A barra de abas recebeu overflow horizontal responsivo. A migration [`20260717120000_knowledge_foundation_rls.sql`](../supabase/migrations/20260717120000_knowledge_foundation_rls.sql) corrige a leitura cross-tenant de `clinic_info`, cria escrita apenas para `owner`/`admin`, adiciona grants e uma restrição de 4.000 caracteres para novos/atualizados. Ela é arquivo de entrega e **não foi aplicada**.

### A3 — status da consulta versus preço

Em [`copilot.ts`](../supabase/functions/_shared/copilot.ts):

- `buildKnowledgePacket` foi exportado e consulta `consultation_fee` separadamente, evitando que o fato-estrela desapareça pelo limite geral;
- os valores `free`, `paid` e `first_free` são formatados com `[fonte:clinic_info#consultation_fee]` e token estruturado `consultation_fee=<enum>`;
- a persona agora proíbe valor monetário, mas exige informar o status gratuito/pago quando há fonte;
- `hasUnsourcedPolicyClaim`/`validateAgentReply` exigem `policyEvidence` confiável, impedem marcador forjado pelo transcript e rejeitam status contraditório à fonte;
- o pacote trunca valores legados de `clinic_info` para 1.200 caracteres;
- o `clinicInfoService` valida limites, opções canônicas e faz upsert explícito em `tenant_id,key`.

Os cenários `consulta_gratuita` e `consulta_sem_dado` foram adicionados ao runner. O runner usa o formatador de produção para injetar o fato; a segunda situação não permite inventar o status. Os testes unitários cobrem spoof de provenance, `free`/`paid`/`first_free`, português/inglês/espanhol, frases naturais de cobrança e falso positivo de “free slot”.

## Gates executados

### Typecheck Edge

Comando equivalente ao protocolo, usando a instalação local do Deno (o `npx` do PowerShell estava bloqueado por policy):

```text
deno check _shared/copilot.ts _tests/evals/run.ts
Check _shared/copilot.ts
Check _tests/evals/run.ts
```

Resultado: passou. O Deno apenas avisou que `allowJs` do `deno.json` é uma opção ignorada.

### Unit tests

```text
deno test -A _tests/evals/unit_test.ts
ok | 40 passed | 0 failed
```

### Typecheck React

```text
npx.cmd tsc --noEmit
Exit code: 0
```

### Eval conversacional obrigatório

```text
deno run -A _tests/evals/run.ts
❌ ANTHROPIC_API_KEY não definida no ambiente.
```

Não houve tentativa de contornar o gate, usar chave inventada ou ajustar teste para obter verde. Sem a chave, a Fase 1 é marcada como **parcial: código e gates determinísticos verdes; eval real bloqueado**.

## Fases não iniciadas por dependência do gate

### Fase 2 — Knowledge Gap Loop

Estado: **não iniciada**. Não foram criados `knowledge_gaps`, `classifyKnowledgeGap`, painel de perguntas ou fluxo de resposta. A migration de Fase 1 é independente e continua pendente de aplicação pelo orquestrador.

### Fase 3 — conhecimento global

Estado: **não iniciada**. Nenhum `global_knowledge`, seed, merge tenant>global ou tela super-admin foi criado. Tópicos globais semeados: **nenhum**.

### Fase 4 — onboarding por IA

Estado: **não iniciada**. Nenhuma Edge Function de extração, ingestão de URL/arquivo ou revisão de sugestões foi criada. Portanto não há dado extraído automaticamente que possa virar ativo sem revisão.

### Fase 5 — RAG

Estado: **não iniciada**. Não foi criado RPC de similaridade nem alterado o pipeline de embeddings. A decisão preliminar documentada para quando o gate permitir avanço é manter OpenAI `text-embedding-3-small`: a tabela existente usa `vector(1536)` e a Edge Function já aponta para esse modelo. Prós: menor diff, infraestrutura alinhada e qualidade conhecida. Contras: custo/latência externos, dependência de API e chave atualmente vazia. A recomendação é `RAG_ENABLED=false` até decisão explícita do orquestrador; falha de embedding deve sempre cair no pacote atual.

## Layouts e fluxos entregues

O fluxo da Fase 1 é: administrador abre Settings → Base de Conhecimento → escolhe a seção → preenche o campo guiado → salva o card → o valor persistido aparece como ativo e sobe a barra de completude. Limpar um valor remove o fato ativo. A UI nunca expõe editor chave-valor cru.

## Análise crítica honesta

1. O eval real não pode ser substituído por unit tests: o modelo pode escolher transferir ou responder em idioma inesperado mesmo com todos os guards determinísticos verdes.
2. A migration RLS ainda precisa ser aplicada e validada contra o banco real; até lá a tela não deve ser considerada disponível em produção.
3. O schema histórico de `clinic_info` tem `tenant_id` nullable e o repositório possui divergências de schema (`knowledge_base.location_id`), portanto migrations futuras precisam ser testadas em reset e em banco legado.
4. A validação lexical de status cobre formas comuns, mas não é uma prova semântica completa. O token estruturado e a comparação com a fonte reduzem o risco; uma futura resposta de status poderia ser composta deterministicamente pelo sistema.
5. O runner existente não reproduz todo o portão de runtime de produção (regeneração, detector de loop e validator completo); por isso os unitários do validator são necessários, mas não equivalem ao eval.
6. O conteúdo persistido por administradores é confiável somente após autorização/RLS; o pacote ainda depende de limites defensivos e de revisão humana para qualquer futura ingestão não estruturada.
7. A policy existente de `master_config` continua fora do escopo e merece correção independente, pois a tabela pode conter credenciais e a policy histórica é ampla.

## Próximo passo seguro

Disponibilizar `ANTHROPIC_API_KEY` apenas no ambiente de execução dos evals, rodar novamente o gate da Fase 1 e, somente com 100% verde, iniciar a Fase 2 na ordem especificada. O orquestrador deve aplicar a migration de fundação separadamente; este trabalho não faz deploy nem aplica SQL em produção.
