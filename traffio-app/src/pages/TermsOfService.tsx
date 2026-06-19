import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Scale, ShieldAlert, CheckCircle, FileText } from 'lucide-react';

export const TermsOfService = () => {
  const { t } = useTranslation('legal');
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-[#0D1B2A] text-white py-6 px-6 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="Traffio" className="h-10 w-10 rounded-xl cursor-pointer" onClick={() => navigate('/')} />
            <div>
              <p className="text-lg font-black leading-none">Traffio</p>
              <p className="text-[10px] text-amber-400 font-bold tracking-wider">{t('shared.brandTagline')}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-amber-400 transition-colors border-none bg-transparent cursor-pointer"
          >
            <ArrowLeft size={16} />
            {t('shared.backToHome')}
          </button>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-[#0D1B2A] text-white py-16 px-6 relative overflow-hidden">
        <div className="absolute -inset-4 bg-gradient-to-tr from-amber-500/10 to-transparent rounded-[40px] blur-3xl opacity-50" />
        <div className="max-w-4xl mx-auto relative z-10 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800/80 border border-slate-700 text-amber-400 rounded-full text-xs font-black uppercase tracking-wider mb-4">
            <Scale size={14} />
            {t('termsOfService.heroBadge')}
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight">
            {t('termsOfService.heroTitle')}
          </h1>
          <p className="text-slate-400 text-base font-medium max-w-2xl leading-relaxed">
            {t('termsOfService.lastUpdatedLabel')} 15 de junho de 2026. {t('termsOfService.heroSubtitle')}
          </p>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 md:py-16">
        <div className="bg-white rounded-[32px] shadow-sm border border-slate-200/60 p-8 md:p-12 space-y-10 leading-relaxed text-slate-600">
          
          {/* Resumo visual rápido */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 mb-3"><FileText size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('termsOfService.summaryCards.saasLicense.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('termsOfService.summaryCards.saasLicense.description')}</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-600 mb-3"><ShieldAlert size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('termsOfService.summaryCards.responsibility.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('termsOfService.summaryCards.responsibility.description')}</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-3"><CheckCircle size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('termsOfService.summaryCards.cancellation.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('termsOfService.summaryCards.cancellation.description')}</p>
            </div>
          </div>

          {/* Seção 1 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">1.</span> {t('termsOfService.sections.acceptance.title')}
            </h2>
            <p>
              {t('termsOfService.sections.acceptance.body1.prefix')} <strong>Traffio Odonto Marketing</strong>{t('termsOfService.sections.acceptance.body1.suffix')}
            </p>
            <p>
              {t('termsOfService.sections.acceptance.body2.prefix')} <strong>{t('termsOfService.sections.acceptance.body2.strong1')}</strong> {t('termsOfService.sections.acceptance.body2.middle')} <strong>{t('termsOfService.sections.acceptance.body2.strong2')}</strong>{t('termsOfService.sections.acceptance.body2.suffix')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 2 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">2.</span> {t('termsOfService.sections.serviceDescription.title')}
            </h2>
            <p>
              {t('termsOfService.sections.serviceDescription.body1')}
            </p>
            <p>
              {t('termsOfService.sections.serviceDescription.body2')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 3 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">3.</span> {t('termsOfService.sections.accountSecurity.title')}
            </h2>
            <p>
              {t('termsOfService.sections.accountSecurity.body1')}
            </p>
            <p>
              {t('termsOfService.sections.accountSecurity.body2')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 4 */}
          <section className="space-y-4 bg-amber-50/50 p-6 md:p-8 rounded-3xl border border-amber-100/80">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">4.</span> {t('termsOfService.sections.thirdPartyIntegrations.title')}
            </h2>
            <p>
              {t('termsOfService.sections.thirdPartyIntegrations.intro.prefix')} <strong>{t('termsOfService.sections.thirdPartyIntegrations.intro.strong1')}</strong> {t('termsOfService.sections.thirdPartyIntegrations.intro.middle')} <strong>{t('termsOfService.sections.thirdPartyIntegrations.intro.strong2')}</strong>{t('termsOfService.sections.thirdPartyIntegrations.intro.suffix')}
            </p>
            <ul className="list-disc pl-6 space-y-2 text-sm text-slate-600">
              {(t('termsOfService.sections.thirdPartyIntegrations.items', { returnObjects: true }) as { label: string; text: string }[]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong> {item.text}</li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 5 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">5.</span> {t('termsOfService.sections.billing.title')}
            </h2>
            <p>
              {t('termsOfService.sections.billing.intro')}
            </p>
            <ul className="list-disc pl-6 space-y-2">
              {(t('termsOfService.sections.billing.items', { returnObjects: true }) as { label: string; text: string }[]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong> {item.text}</li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 6 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">6.</span> {t('termsOfService.sections.liabilityLimitation.title')}
            </h2>
            <p>
              {t('termsOfService.sections.liabilityLimitation.intro')}
            </p>
            <ul className="list-disc pl-6 space-y-2">
              {(t('termsOfService.sections.liabilityLimitation.items', { returnObjects: true }) as string[]).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 7 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">7.</span> {t('termsOfService.sections.termsChangesAndJurisdiction.title')}
            </h2>
            <p>
              {t('termsOfService.sections.termsChangesAndJurisdiction.body1')}
            </p>
            <p>
              {t('termsOfService.sections.termsChangesAndJurisdiction.body2')}
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0D1B2A] py-10 px-6 text-slate-500 text-sm border-t border-slate-800">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p>{t('shared.footerRights')}</p>
          <div className="flex gap-6 text-xs text-slate-400 font-medium">
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/privacidade')}>{t('termsOfService.footerPrivacyLink')}</span>
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/')}>{t('shared.footerHome')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
