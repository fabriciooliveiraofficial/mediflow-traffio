import React from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePortalTenant } from '../hooks/usePortalTenant';

export function PatientAuthLayout() {
    const { t } = useTranslation('portal');
    const { tenant, loading, error } = usePortalTenant();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error || !tenant) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('authLayout.tenantNotFoundTitle')}</h1>
                <p className="text-gray-600">{t('authLayout.tenantNotFoundText')}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-white sm:bg-gray-50 p-4 font-sans">
            {/* Container - Full width on Mobile, Card on Desktop */}
            <div className="w-full max-w-[440px] bg-white sm:rounded-2xl sm:shadow-xl sm:overflow-hidden">

                {/* Minimal Header */}
                <div className="pt-8 pb-4 text-center">
                    {tenant.logo_url ? (
                        <img
                            src={tenant.logo_url}
                            alt={tenant.name}
                            className="h-12 mx-auto object-contain"
                        />
                    ) : (
                        <div
                            className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 text-primary font-bold text-xl"
                            style={{ backgroundColor: `${tenant.color_primary}1A`, color: tenant.color_primary }}
                        >
                            {tenant.name.substring(0, 2).toUpperCase()}
                        </div>
                    )}
                    {!tenant.logo_url && (
                        <h2 className="mt-3 text-lg font-bold text-gray-800">{tenant.name}</h2>
                    )}
                </div>

                {/* Content (Login/Register Forms) */}
                <div className="px-8 pb-8">
                    <Outlet context={{ tenant }} />
                </div>
            </div>

            <p className="mt-8 text-center text-xs text-gray-400">
                {t('authLayout.securePoweredByPrefix')} <strong>{t('authLayout.brandName')}</strong>
            </p>
        </div>
    );
}
