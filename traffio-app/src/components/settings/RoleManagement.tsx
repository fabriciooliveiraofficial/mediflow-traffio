import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Plus, Trash2, Edit3, Loader2, X, Check, AlertCircle } from 'lucide-react';
import { roleService, type ProfessionalRole } from '../../services/roleService';
import { useToast } from '../../contexts/ToastContext';

interface RoleManagementProps {
    tenantId: string;
}

export function RoleManagement({ tenantId }: RoleManagementProps) {
    const { t } = useTranslation('settings');
    const { showToast } = useToast();
    const [roles, setRoles] = useState<ProfessionalRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingRole, setEditingRole] = useState<ProfessionalRole | null>(null);
    const [formName, setFormName] = useState('');
    const [formBaseRole, setFormBaseRole] = useState<'doctor' | 'staff' | 'admin'>('staff');

    const loadRoles = async () => {
        setLoading(true);
        try {
            const data = await roleService.getAll(tenantId);
            setRoles(data);
        } catch (err: any) {
            showToast('error', t('roles.toastLoadError', 'Erro ao carregar cargos.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (tenantId) {
            loadRoles();
        }
    }, [tenantId]);

    const handleOpenCreate = () => {
        setEditingRole(null);
        setFormName('');
        setFormBaseRole('staff');
        setShowModal(true);
    };

    const handleOpenEdit = (role: ProfessionalRole) => {
        setEditingRole(role);
        setFormName(role.name);
        setFormBaseRole(role.base_role);
        setShowModal(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formName.trim()) return;

        setSaving(true);
        try {
            if (editingRole) {
                await roleService.update(editingRole.id, formName.trim(), formBaseRole);
                showToast('success', t('roles.toastUpdated'));
            } else {
                await roleService.create(tenantId, formName.trim(), formBaseRole);
                showToast('success', t('roles.toastCreated'));
            }
            setShowModal(false);
            loadRoles();
        } catch (err: any) {
            showToast('error', t('roles.toastSaveError'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (role: ProfessionalRole) => {
        if (!confirm(t('roles.confirmDelete', { name: role.name }))) return;

        try {
            await roleService.delete(role.id);
            showToast('success', t('roles.toastDeleted'));
            loadRoles();
        } catch (err: any) {
            showToast('error', t('roles.toastDeleteError', 'Erro ao excluir cargo.'));
        }
    };

    const getBaseRoleLabel = (baseRole: string) => {
        switch (baseRole) {
            case 'doctor':
                return t('roles.baseRoleDoctor');
            case 'admin':
                return t('roles.baseRoleAdmin');
            default:
                return t('roles.baseRoleStaff');
        }
    };

    const getBaseRoleBadgeColor = (baseRole: string) => {
        switch (baseRole) {
            case 'doctor':
                return 'bg-emerald-50 border-emerald-200 text-emerald-700';
            case 'admin':
                return 'bg-purple-50 border-purple-200 text-purple-700';
            default:
                return 'bg-blue-50 border-blue-200 text-blue-700';
        }
    };

    return (
        <div className="bg-white rounded-3xl border border-ice-100 shadow-sm overflow-hidden p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-graphite-900 tracking-tight">{t('roles.title')}</h2>
                    <p className="text-graphite-500 font-medium text-sm mt-1">{t('roles.subtitle')}</p>
                </div>
                <button
                    onClick={handleOpenCreate}
                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer w-fit self-end sm:self-auto"
                >
                    <Plus size={18} />
                    <span>{t('roles.addRole')}</span>
                </button>
            </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="animate-spin text-brand-primary" size={32} />
                    <p className="text-sm font-semibold text-graphite-400">{t('roles.loading')}</p>
                </div>
            ) : roles.length === 0 ? (
                <div className="py-16 text-center border-2 border-dashed border-ice-200 rounded-3xl p-8">
                    <Briefcase className="w-12 h-12 mx-auto text-graphite-300 mb-3" />
                    <p className="font-bold text-graphite-700">{t('roles.empty')}</p>
                </div>
            ) : (
                <div className="border border-ice-100 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-ice-50 border-b border-ice-100">
                                <th className="p-4 text-xs font-black text-graphite-500 uppercase tracking-wider">{t('roles.roleNameLabel')}</th>
                                <th className="p-4 text-xs font-black text-graphite-500 uppercase tracking-wider">{t('roles.baseRoleLabel')}</th>
                                <th className="p-4 text-xs font-black text-graphite-500 uppercase tracking-wider text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ice-50 bg-white">
                            {roles.map((role) => (
                                <tr key={role.id} className="hover:bg-ice-50/30 transition-colors">
                                    <td className="p-4">
                                        <p className="font-bold text-graphite-900 text-sm">{role.name}</p>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border uppercase ${getBaseRoleBadgeColor(role.base_role)}`}>
                                            {role.base_role === 'doctor' && '🩺'}
                                            {role.base_role === 'staff' && '👤'}
                                            {role.base_role === 'admin' && '👑'}
                                            {role.base_role === 'doctor' ? 'Médico' : role.base_role === 'admin' ? 'Administrador' : 'Recepção'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleOpenEdit(role)}
                                                className="p-2 rounded-xl bg-ice-50 hover:bg-ice-100 hover:text-brand-primary text-graphite-500 transition-all border-none cursor-pointer"
                                                title={t('roles.editRole')}
                                            >
                                                <Edit3 size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(role)}
                                                className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-500 hover:text-rose-700 transition-all border-none cursor-pointer"
                                                title="Excluir Cargo"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal: Criar / Editar Cargo */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-5 border-b border-ice-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                                    <Briefcase size={18} className="text-brand-primary" />
                                </div>
                                <h3 className="text-base font-black text-graphite-900">
                                    {editingRole ? t('roles.editRole') : t('roles.addRole')}
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 rounded-xl hover:bg-ice-50 text-graphite-400 transition-colors border-none cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-6 space-y-5">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-graphite-900 block">{t('roles.roleNameLabel')}</label>
                                <input
                                    type="text"
                                    required
                                    placeholder={t('roles.roleNamePlaceholder')}
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-graphite-900 block">{t('roles.baseRoleLabel')}</label>
                                <select
                                    value={formBaseRole}
                                    onChange={(e) => setFormBaseRole(e.target.value as any)}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary cursor-pointer h-[46px]"
                                >
                                    <option value="doctor">{t('roles.baseRoleDoctor')}</option>
                                    <option value="staff">{t('roles.baseRoleStaff')}</option>
                                    <option value="admin">{t('roles.baseRoleAdmin')}</option>
                                </select>
                            </div>

                            <div className="flex justify-end gap-3 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-5 py-2.5 rounded-xl text-sm font-bold text-graphite-500 hover:bg-ice-50 transition-colors border-none cursor-pointer"
                                >
                                    {t('roles.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || !formName.trim()}
                                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer disabled:opacity-50"
                                >
                                    {saving ? (
                                        <Loader2 className="animate-spin" size={16} />
                                    ) : (
                                        <Check size={16} />
                                    )}
                                    <span>{t('roles.save')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
