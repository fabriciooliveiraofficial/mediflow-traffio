/**
 * webhookIdempotency — compensação do marcador de idempotência de webhooks
 * (whatsapp-bot/index.ts).
 *
 * Bug de produção (2026-07-23): o webhook gravava `processed_webhooks` ANTES
 * do passo durável seguinte (INSERT em message_inbox). Se esse insert falhasse
 * por motivo transitório (timeout de DB, pico de carga — qualquer coisa que
 * não seja duplicidade real), o marcador de idempotência já estava committado
 * e a retentativa do provedor batia em 23505 para sempre: a mensagem nunca
 * chegava a existir em lugar nenhum — perda silenciosa e permanente, sem tag
 * de erro, sem ir para a fila humana. Algumas mensagens do AI Agent
 * simplesmente não eram atendidas, sem nenhum rastro do porquê.
 */

/** Assinatura mínima que qualquer client Supabase (real ou mock) satisfaz. */
export interface SupabaseLike {
  from(table: string): {
    delete(): { eq(col: string, val: string): { eq(col: string, val: string): Promise<{ error: { message: string } | null }> } };
  };
}

/**
 * Desfaz o marcador de idempotência (processed_webhooks) quando o passo
 * durável seguinte (INSERT em message_inbox) falha por motivo NÃO relacionado
 * a duplicidade. Best-effort (nunca lança): melhor tentar destravar a
 * retentativa do que falhar o próprio compensador.
 */
export async function compensateIdempotencyMarker(
  supabase: SupabaseLike,
  tenantId: string,
  messageId: string,
  provider: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("processed_webhooks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("message_id", messageId);
    if (error) {
      console.error(`[whatsapp-bot] ${provider}: compensação de idempotência falhou [${messageId}]:`, error.message);
    }
  } catch (err: any) {
    console.error(`[whatsapp-bot] ${provider}: compensação de idempotência lançou [${messageId}]:`, err?.message);
  }
}
