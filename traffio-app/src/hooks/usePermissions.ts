import { useCallback } from 'react';
import { useTenant } from '../contexts/TenantContext';

// ─── Permission Map ───────────────────────────────────────────────────────────
// Define quais roles têm acesso a cada permissão/página.
// Quanto mais à direita na hierarquia, menos acesso.
// Hierarquia: owner > admin > manager > doctor > attendant > staff

export const PERMISSION_MAP: Record<string, string[]> = {
  // Páginas
  'page:today':         ['owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'],
  'page:dashboard':     ['owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'],
  'page:agenda':        ['owner', 'admin', 'manager', 'doctor', 'attendant'],
  'page:inbox':         ['owner', 'admin', 'manager', 'attendant'],
  'page:followup':      ['owner', 'admin', 'manager', 'attendant'],
  'page:leads':         ['owner', 'admin', 'manager', 'attendant'],
  'page:reception':     ['owner', 'admin', 'manager', 'attendant', 'staff'],
  'page:financial':     ['owner', 'admin', 'manager'],
  'page:professionals': ['owner', 'admin', 'manager'],
  'page:services':      ['owner', 'admin', 'manager'],
  'page:automations':   ['owner', 'admin', 'manager'],
  'page:flows':         ['owner', 'admin'],
  'page:whatsapp':      ['owner', 'admin'],
  'page:intelligence':  ['owner', 'admin', 'manager'],
  'page:settings':      ['owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'],
  'page:odontology':    ['owner', 'admin', 'manager', 'doctor'],
  'page:nutrition':     ['owner', 'admin', 'manager', 'doctor'],
  'page:medical-records': ['owner', 'admin', 'manager', 'doctor'],

  // Ações
  'action:invite_member':  ['owner', 'admin', 'manager'],
  'action:manage_team':    ['owner', 'admin'],
  'action:edit_config':    ['owner', 'admin'],
  'action:view_financial': ['owner', 'admin', 'manager'],
  'action:cancel_appt':    ['owner', 'admin', 'manager', 'attendant'],
  'action:book_appt':      ['owner', 'admin', 'manager', 'doctor', 'attendant'],
  'action:generate_billing': ['owner', 'admin', 'manager', 'attendant'],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissions() {
  const { userRole } = useTenant();

  const can = useCallback((permission: string): boolean => {
    if (!userRole) return false;
    // super_admin tem acesso total
    if (userRole === 'super_admin') return true;
    const allowedRoles = PERMISSION_MAP[permission];
    if (!allowedRoles) return true; // sem restrição mapeada → permitir
    return allowedRoles.includes(userRole);
  }, [userRole]);

  const canAny = useCallback((...permissions: string[]): boolean => {
    return permissions.some(p => can(p));
  }, [can]);

  const canAll = useCallback((...permissions: string[]): boolean => {
    return permissions.every(p => can(p));
  }, [can]);

  return { can, canAny, canAll, role: userRole };
}
