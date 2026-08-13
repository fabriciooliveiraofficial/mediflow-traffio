/**
 * reminderScheduling_test — 2026-08-13. Incidente reportado pelo usuário:
 * "lembretes constam como pendente e nunca são enviados".
 *
 * Diagnóstico capturado AO VIVO em produção (tenant Dental Test 4, timezone
 * Pacific/Auckland, consulta às 08:30 local):
 *
 *   08:14:14 NZ → reminder_custom_-15 existia, status 'pending', sch 08:15
 *   08:15:37 NZ → ZERO linhas para o agendamento; conversation_messages com
 *                 message_type='appointment_reminder' nos últimos 3 dias: 0
 *
 * A linha não foi enviada: foi DELETADA no minuto em que venceu. Duas falhas
 * encadeadas, cobertas por estes testes:
 *
 *   1. getSafeScheduledTime remapeava o lembrete de "1h antes" (07:30, dentro
 *      da janela de silêncio fixa 22h–08h) para a "noite anterior" com
 *      dayOffset -1 — horário que já estava no PASSADO, porque o agendamento
 *      foi criado às 02:00 da madrugada.
 *   2. O envio era vetado pela janela de silêncio a cada minuto até as 08:00,
 *      e nesse intervalo a limpeza do schedule-reminders removia a linha
 *      (DELETE que, com queueBatch vazio, rodava sem filtro de message_type).
 *
 * O resultado não deixava rastro nenhum — nem 'failed', nem error_message, nem
 * linha — que é exatamente por que o bug sobreviveu a várias auditorias.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  getLocalTime,
  getSafeScheduledTime,
  isAppointmentAnchoredOffset,
  isBlockedByQuietHours,
  isReminderTargetStillEligible,
  REMINDER_LATE_GRACE_MS,
  shouldDeferForQuietHours,
} from "../../_shared/tenantTime.ts";

const NZ = "Pacific/Auckland";

// Consulta real do incidente: 2026-08-14 08:30 em Auckland (UTC+12).
const APPT_UTC = new Date("2026-08-13T20:30:00Z");
const MIN = 60 * 1000;

// ── isAppointmentAnchoredOffset ──────────────────────────────────────────────

Deno.test("isAppointmentAnchoredOffset: -15 e -60 (os dois lembretes da clínica) são ancorados", () => {
  assert(isAppointmentAnchoredOffset(-15));
  assert(isAppointmentAnchoredOffset(-60));
});

Deno.test("isAppointmentAnchoredOffset: limite -120 ancorado; -24h/-48h não são", () => {
  assert(isAppointmentAnchoredOffset(-120));
  assert(!isAppointmentAnchoredOffset(-1440));
  assert(!isAppointmentAnchoredOffset(-2880));
});

// ── getSafeScheduledTime: o bug exato do lembrete de 1 hora ──────────────────

Deno.test("lembrete de 1h antes de consulta às 08:30 mantém 07:30 local (era remapeado e morria)", () => {
  const target = new Date(APPT_UTC.getTime() - 60 * MIN); // 07:30 NZ

  // Sanidade: 07:30 realmente cai dentro da janela de silêncio fixa (22h–08h).
  assertEquals(getLocalTime(target, NZ).hour, 7);
  assert(isBlockedByQuietHours(target, NZ));

  const scheduled = getSafeScheduledTime(target, "reminder_custom_-60", NZ, {
    anchoredToAppointment: isAppointmentAnchoredOffset(-60),
  });

  assertEquals(scheduled, target.toISOString());
  assertEquals(getLocalTime(new Date(scheduled), NZ), { hour: 7, minute: 30 });
});

Deno.test("lembrete de 15min antes mantém 08:15 local (fora do silêncio, não deve mudar)", () => {
  const target = new Date(APPT_UTC.getTime() - 15 * MIN); // 08:15 NZ
  const scheduled = getSafeScheduledTime(target, "reminder_custom_-15", NZ, {
    anchoredToAppointment: isAppointmentAnchoredOffset(-15),
  });
  assertEquals(scheduled, target.toISOString());
  assertEquals(getLocalTime(new Date(scheduled), NZ), { hour: 8, minute: 15 });
});

Deno.test("sem âncora (24h/48h), o remapeamento para fora do silêncio continua valendo", () => {
  // 03:00 NZ bem no futuro: nada de passado envolvido, só o remapeamento.
  const target = new Date("2026-12-01T14:00:00Z"); // 03:00 NZ de 02/12
  assert(isBlockedByQuietHours(target, NZ));

  const scheduled = getSafeScheduledTime(target, "reminder_24h", NZ, {
    anchoredToAppointment: isAppointmentAnchoredOffset(-1440),
  });

  assert(scheduled !== target.toISOString(), "deveria ter sido remapeado");
  assert(!isBlockedByQuietHours(new Date(scheduled), NZ), "remapeado ainda no silêncio");
});

Deno.test("remapeamento nunca devolve horário no passado (dayOffset -1 andava para trás)", () => {
  // Alvo no futuro próximo, dentro do silêncio: o remap para a "noite anterior"
  // cairia antes de agora — foi assim que a linha nasceu morta em produção.
  const target = new Date(Date.now() + 30 * MIN);
  const scheduled = getSafeScheduledTime(target, "reminder_24h", NZ);
  assert(
    new Date(scheduled).getTime() >= Date.now() - MIN,
    `scheduled_at no passado: ${scheduled}`,
  );
});

// ── shouldDeferForQuietHours: o veto que matava o lembrete no envio ──────────

Deno.test("NÃO adia lembrete cujo horário planejado já está dentro do silêncio (o caso 07:30)", () => {
  const planned = new Date(APPT_UTC.getTime() - 60 * MIN); // 07:30 NZ
  // Worker rodando exatamente no horário planejado.
  assertEquals(shouldDeferForQuietHours(planned, planned, NZ), false);
});

Deno.test("adia mensagem planejada FORA do silêncio quando o envio atrasou para dentro dele", () => {
  const planned = new Date("2026-08-13T06:00:00Z"); // 18:00 NZ — fora do silêncio
  const now = new Date("2026-08-13T14:00:00Z");     // 02:00 NZ — dentro do silêncio
  assert(!isBlockedByQuietHours(planned, NZ));
  assert(isBlockedByQuietHours(now, NZ));
  assertEquals(shouldDeferForQuietHours(planned, now, NZ), true);
});

Deno.test("fora da janela de silêncio nunca adia, qualquer que seja o planejado", () => {
  const now = new Date(APPT_UTC.getTime() - 15 * MIN); // 08:15 NZ
  assertEquals(shouldDeferForQuietHours(now, now, NZ), false);
  assertEquals(shouldDeferForQuietHours(null, now, NZ), false);
});

Deno.test("scheduled_at ausente ou inválido dentro do silêncio: adia (comportamento conservador)", () => {
  const now = new Date("2026-08-13T14:00:00Z"); // 02:00 NZ
  assertEquals(shouldDeferForQuietHours(null, now, NZ), true);
  assertEquals(shouldDeferForQuietHours("nao-e-data", now, NZ), true);
});

// ── Cenário completo do incidente, ponta a ponta ─────────────────────────────

Deno.test("cenário do incidente: ambos os lembretes sobrevivem e saem no horário certo", () => {
  const offsets = [-60, -15];
  const agendados = offsets.map((off) => {
    const target = new Date(APPT_UTC.getTime() + off * MIN);
    return {
      off,
      scheduled: new Date(
        getSafeScheduledTime(target, `reminder_custom_${off}`, NZ, {
          anchoredToAppointment: isAppointmentAnchoredOffset(off),
        }),
      ),
    };
  });

  for (const { off, scheduled } of agendados) {
    // Horário local exatamente igual ao configurado pela clínica.
    const esperado = getLocalTime(new Date(APPT_UTC.getTime() + off * MIN), NZ);
    assertEquals(getLocalTime(scheduled, NZ), esperado, `offset ${off}`);
    // E o worker não o adia quando roda no horário planejado.
    assertEquals(shouldDeferForQuietHours(scheduled, scheduled, NZ), false, `offset ${off}`);
  }
});

// ── isReminderTargetStillEligible: segundo incidente ao vivo (13/08/2026) ────
//
// Depois da primeira correção, o usuário testou de ponta a ponta: consulta
// marcada para as 10:00, lembrete de -30min. Alvo = exatamente 09:30:00. O
// cron dispara às 09:30:00 em ponto, mas a invocação (rede + várias consultas
// ao banco antes de chegar neste agendamento) levou alguns segundos — quando
// o código comparou "alvo < agora", o "agora" capturado já era 09:30:0x. O
// guard antigo (`if (targetAt < now.getTime()) return`) descartava a linha
// PERMANENTEMENTE: a mesma comparação repete o mesmo resultado em todo tick
// seguinte, então o lembrete nunca era criado — sem erro, sem rastro. Achado
// em produção antes de virar teste (outbound_message_queue com 0 linhas para
// os dois agendamentos de teste do usuário).

Deno.test("isReminderTargetStillEligible: alvo poucos segundos no passado (a corrida real) ainda é elegível", () => {
  const targetMs = new Date("2026-08-14T09:30:00").getTime();
  const nowMs = new Date("2026-08-14T09:30:03").getTime(); // invocação levou 3s
  assert(isReminderTargetStillEligible(targetMs, nowMs));
});

Deno.test("isReminderTargetStillEligible: alvo genuinamente obsoleto (30min no passado) continua excluído", () => {
  const targetMs = new Date("2026-08-14T09:00:00").getTime(); // -60min de uma consulta às 10:00
  const nowMs = new Date("2026-08-14T09:30:00").getTime();    // agendamento só existe a partir daqui
  assert(!isReminderTargetStillEligible(targetMs, nowMs));
});

Deno.test("isReminderTargetStillEligible: exatamente no limite da tolerância (5min) ainda elegível; passando disso não", () => {
  const nowMs = new Date("2026-08-14T09:30:00").getTime();
  assert(isReminderTargetStillEligible(nowMs - REMINDER_LATE_GRACE_MS, nowMs));
  assert(!isReminderTargetStillEligible(nowMs - REMINDER_LATE_GRACE_MS - 1, nowMs));
});

Deno.test("isReminderTargetStillEligible: alvo no futuro é sempre elegível", () => {
  const nowMs = Date.now();
  assert(isReminderTargetStillEligible(nowMs + 60 * MIN, nowMs));
});
