# AI WHATSAPP CLINICAL AGENT
## REENGENHARIA NA PÁGINA "INTELIGÊNCIA"

---

# CONTEXTO OBRIGATÓRIO

A plataforma SaaS já existe.

A página **"Inteligência"** já possui um modelo de agente implementado, porém:

- O agente alucina respostas fora do contexto.
- Não mantém estado de conversa.
- Não consegue concluir agendamentos.
- Não valida informações com o banco.
- Não possui controle determinístico.
- Não possui máquina de estados.
- Não tem validação estrutural de resposta da IA.
- A conversa se perde facilmente.
- Não consegue manter consistência em múltiplas mensagens.

⚠ NÃO criar nova página.
⚠ NÃO criar novo módulo separado.
⚠ NÃO ignorar o código existente.
⚠ REENGENHAR a lógica da página "Inteligência".

---

# OBJETIVO

Transformar a página "Inteligência" em um:

AI WHATSAPP CLINICAL AGENT

Determinístico, robusto, multi-clínica, sem alucinações e com controle total de fluxo conversacional.

---

# PROBLEMAS ATUAIS QUE DEVEM SER CORRIGIDOS

1. IA decide tudo sozinha.
2. IA não usa schema obrigatório.
3. Não há state machine.
4. Não há validação antes de confirmar agendamento.
5. Não há controle transacional.
6. Não há fallback humano estruturado.
7. Não há orquestrador clínico determinístico.
8. IA gera horários que não existem.

---

# NOVA ARQUITETURA DENTRO DA PÁGINA "INTELIGÊNCIA"

A página deve ser refatorada para conter 4 camadas internas:

1. AI Interpretation Layer
2. Conversation State Machine
3. Clinical Orchestrator
4. WhatsApp Integration Handler

---

# 1️⃣ AI INTERPRETATION LAYER

Substituir qualquer lógica atual por:

- Prompt estruturado
- JSON obrigatório
- Schema Zod
- Revalidação
- Regeneração automática se inválido

A IA deve responder APENAS com:

{
  intent: string,
  entities: object,
  confidence: number
}

Se resposta não bater com schema → regenerar.

---

# 2️⃣ CONVERSATION STATE MACHINE (OBRIGATÓRIO)

Implementar com XState.

Persistir estado na tabela conversation_sessions.

Estados mínimos:

- idle
- awaiting_specialty
- awaiting_location
- awaiting_date
- awaiting_time
- confirming
- booked
- cancelled
- fallback_human

A IA NÃO pode alterar estado diretamente.
Somente o backend pode.

---

# 3️⃣ CLINICAL ORCHESTRATOR (DETERMINÍSTICO)

Criar camada separada de regras.

Funções obrigatórias:

- findDoctorsBySpecialty()
- findLocationsByDoctor()
- generateAvailableSlots()
- validateSlot()
- createAppointment()
- cancelAppointment()

Slot generation:

1. Buscar availability rules
2. Gerar grade horária
3. Remover:
   - appointments existentes
   - blocked_slots
4. Ordenar
5. Retornar 3–5 opções

A IA nunca gera horários.
A IA apenas verbaliza resultados reais do banco.

---

# 4️⃣ LOCK TRANSACIONAL

Antes de confirmar:

- Revalidar disponibilidade
- Inserir appointment
- Tratar erro de conflito

Se conflito:
- Gerar novas opções
- Informar paciente

---

# 5️⃣ HUMANIZAÇÃO CONTROLADA

IA recebe apenas:

{
  available_slots: [...]
}

Ela converte para linguagem natural.

Nunca inventa dados.

---

# 6️⃣ FALLBACK HUMANO

Ativar fallback se:

- confidence < 0.75
- 3 erros consecutivos
- intenção fora do escopo

Estado muda para:
fallback_human

---

# 7️⃣ LOGS E OBSERVABILIDADE

Registrar:

- Mensagem recebida
- Estado anterior
- Estado posterior
- Intent detectada
- Entidades
- Ação executada
- Erro (se houver)

---

# 8️⃣ ORDEM DE IMPLEMENTAÇÃO (OBRIGATÓRIA)

1. Refatorar modelagem de estado
2. Implementar state machine
3. Criar orquestrador clínico
4. Implementar schema validation
5. Implementar lock transacional
6. Integrar IA com JSON enforcement
7. Implementar fallback humano
8. Testes unitários
9. Testes de concorrência

Não avançar etapa sem concluir a anterior.

---

# RESULTADO ESPERADO

Após refatoração da página "Inteligência", o agente deve:

✔ Manter conversa consistente
✔ Perguntar especialidade corretamente
✔ Perguntar localização corretamente
✔ Consultar agenda dinâmica
✔ Validar disponibilidade real
✔ Agendar sem conflito
✔ Cancelar
✔ Remarcar
✔ Persistir estado
✔ Evitar alucinação
✔ Operar 100% via WhatsApp
✔ Funcionar multi-clínica

---

# IMPORTANTE

A página "Inteligência" deve se tornar o núcleo de inteligência conversacional do SaaS.

Não criar nova arquitetura paralela.
Não duplicar lógica.
Reestruturar corretamente o que já existe.