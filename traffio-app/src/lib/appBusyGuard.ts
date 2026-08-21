/**
 * Sinal global simples de "não é seguro recarregar a página agora".
 *
 * Qualquer fluxo crítico do app (ex: uma ligação em andamento) se registra
 * aqui, e o auto-update (useAppUpdate.ts) espera não ter mais nenhum motivo
 * registrado antes de aplicar uma atualização sozinho — sem precisar que
 * cada consumidor saiba nada sobre PWA/service worker, e sem precisar de um
 * contexto React global só pra isso.
 */

const busyReasons = new Set<string>();

export function markBusy(id: string) {
  busyReasons.add(id);
}

export function clearBusy(id: string) {
  busyReasons.delete(id);
}

export function isAppBusy(): boolean {
  return busyReasons.size > 0;
}
