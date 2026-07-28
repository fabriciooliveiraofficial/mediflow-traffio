import { detectLanguageDrift } from "./copilot.ts";

const msgs = [
  "Obrigado, Fabricio! Qual o seu email, por favor?",
  "Vejo que você está falando do número X, mas me informou o Y. Gostaria de usar o Y como contato principal?",
  "Apenas com esses 3 dados confirmados em mãos, chame a ferramenta atualizar_cadastro_paciente para registrar/atualizar o cadastro e dê segmento ao atendimento com foco no agendamento.",
  "Qual o seu sobrenome?",
  "Para confirmar seu cadastro e enviar os lembretes do agendamento, qual o seu e-mail?",
  "Obrigado, Fabricio! Para podermos continuar com o agendamento, preciso confirmar o número de telefone. O número de contato principal é este mesmo do WhatsApp ou seria outro?",
  "Obrigado! Qual é o número de telefone principal para contato?"
];

for (let i = 0; i < msgs.length; i++) {
  console.log("msg" + (i+1) + ":", detectLanguageDrift(msgs[i], "pt"));
}
