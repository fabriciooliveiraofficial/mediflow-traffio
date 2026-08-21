import { useEffect } from 'react';
import { markBusy, clearBusy } from '../lib/appBusyGuard';

/**
 * Registra este componente como "app ocupado" enquanto `busy` for true —
 * usado pelo auto-update (useAppUpdate.ts) pra nunca recarregar a página
 * sozinho no meio de um fluxo crítico (ex: uma ligação em andamento).
 */
export function useBusyGuard(id: string, busy: boolean) {
    useEffect(() => {
        if (busy) markBusy(id);
        else clearBusy(id);
        return () => clearBusy(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, busy]);
}
