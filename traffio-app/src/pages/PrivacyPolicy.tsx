import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldCheck, Mail, Lock, Eye, CheckCircle } from 'lucide-react';

export const PrivacyPolicy = () => {
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
            <ShieldCheck size={14} />
            {t('privacyPolicy.heroBadge')}
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight">
            {t('privacyPolicy.heroTitle')}
          </h1>
          <p className="text-slate-400 text-base font-medium max-w-2xl leading-relaxed">
            {t('privacyPolicy.lastUpdatedLabel')} 15 de junho de 2026. {t('privacyPolicy.heroSubtitle')}
          </p>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 md:py-16">
        <div className="bg-white rounded-[32px] shadow-sm border border-slate-200/60 p-8 md:p-12 space-y-10 leading-relaxed text-slate-600">
          
          {/* Resumo visual rápido */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 mb-3"><Lock size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('privacyPolicy.summaryCards.dataProtected.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('privacyPolicy.summaryCards.dataProtected.description')}</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-3"><Eye size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('privacyPolicy.summaryCards.transparentUse.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('privacyPolicy.summaryCards.transparentUse.description')}</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mb-3"><Mail size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">{t('privacyPolicy.summaryCards.fullControl.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('privacyPolicy.summaryCards.fullControl.description')}</p>
            </div>
          </div>

          {/* Seção 1 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">1.</span> {t('privacyPolicy.sections.whoWeAre.title')}
            </h2>
            <p>
              {t('privacyPolicy.sections.whoWeAre.body1.prefix')} <strong>Traffio Odonto Marketing</strong> {t('privacyPolicy.sections.whoWeAre.body1.middle')} <strong>fabriciooliveiraofficial@gmail.com</strong>{t('privacyPolicy.sections.whoWeAre.body1.suffix')}
            </p>
            <p>
              {t('privacyPolicy.sections.whoWeAre.body2')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 2 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">2.</span> {t('privacyPolicy.sections.dataCollection.title')}
            </h2>
            <p>{t('privacyPolicy.sections.dataCollection.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              {(t('privacyPolicy.sections.dataCollection.items', { returnObjects: true }) as { label: string; text: string }[]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong> {item.text}</li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 3 - Crítica para o Google OAuth */}
          <section className="space-y-4 bg-amber-50/50 p-6 md:p-8 rounded-3xl border border-amber-100/80">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">3.</span> {t('privacyPolicy.sections.googleAdsIntegration.title')}
            </h2>
            <p className="font-medium text-slate-800">
              {t('privacyPolicy.sections.googleAdsIntegration.intro.prefix')} <code>{t('privacyPolicy.sections.googleAdsIntegration.intro.code')}</code>{t('privacyPolicy.sections.googleAdsIntegration.intro.suffix')}
            </p>
            <div className="space-y-4 text-sm mt-3">
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.googleAdsIntegration.purpose.heading')}</h4>
                  <p className="text-slate-600">
                    {t('privacyPolicy.sections.googleAdsIntegration.purpose.body.prefix')} <strong>{t('privacyPolicy.sections.googleAdsIntegration.purpose.body.strong')}</strong> {t('privacyPolicy.sections.googleAdsIntegration.purpose.body.suffix')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.googleAdsIntegration.noSharing.heading')}</h4>
                  <p className="text-slate-600">
                    {t('privacyPolicy.sections.googleAdsIntegration.noSharing.body')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.googleAdsIntegration.googleCompliance.heading')}</h4>
                  <p className="text-slate-600 font-medium">
                    {t('privacyPolicy.sections.googleAdsIntegration.googleCompliance.body.prefix')} <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand-primary underline hover:text-amber-500 transition-colors">{t('privacyPolicy.sections.googleAdsIntegration.googleCompliance.body.linkText')}</a>{t('privacyPolicy.sections.googleAdsIntegration.googleCompliance.body.suffix')}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 3.1 - Meta (Facebook e Instagram) Integration */}
          <section className="space-y-4 bg-indigo-50/50 p-6 md:p-8 rounded-3xl border border-indigo-100/80">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">3.1.</span> {t('privacyPolicy.sections.metaIntegration.title')}
            </h2>
            <p className="font-medium text-slate-800">
              {t('privacyPolicy.sections.metaIntegration.intro.prefix')} <code>{t('privacyPolicy.sections.metaIntegration.intro.code1')}</code> {t('privacyPolicy.sections.metaIntegration.intro.middle')} <code>{t('privacyPolicy.sections.metaIntegration.intro.code2')}</code> {t('privacyPolicy.sections.metaIntegration.intro.suffix')}
            </p>
            <div className="space-y-4 text-sm mt-3">
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.metaIntegration.usage.heading')}</h4>
                  <p className="text-slate-600">
                    {t('privacyPolicy.sections.metaIntegration.usage.body.prefix')} <strong>{t('privacyPolicy.sections.metaIntegration.usage.body.strong')}</strong> {t('privacyPolicy.sections.metaIntegration.usage.body.suffix')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.metaIntegration.noSharing.heading')}</h4>
                  <p className="text-slate-600">
                    {t('privacyPolicy.sections.metaIntegration.noSharing.body')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">{t('privacyPolicy.sections.metaIntegration.dataRetention.heading')}</h4>
                  <p className="text-slate-600 font-medium">
                    {t('privacyPolicy.sections.metaIntegration.dataRetention.body.prefix')} <a href="https://developers.facebook.com/terms/" target="_blank" rel="noopener noreferrer" className="text-brand-primary underline hover:text-amber-500 transition-colors">{t('privacyPolicy.sections.metaIntegration.dataRetention.body.linkText')}</a>{t('privacyPolicy.sections.metaIntegration.dataRetention.body.suffix')}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 4 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">4.</span> {t('privacyPolicy.sections.dataSharing.title')}
            </h2>
            <p>
              {t('privacyPolicy.sections.dataSharing.intro')}
            </p>
            <ul className="list-disc pl-6 space-y-2">
              {(t('privacyPolicy.sections.dataSharing.items', { returnObjects: true }) as { label: string; text: string }[]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong> {item.text}</li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 5 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">5.</span> {t('privacyPolicy.sections.dataSecurity.title')}
            </h2>
            <p>
              {t('privacyPolicy.sections.dataSecurity.body1')}
            </p>
            <p>
              {t('privacyPolicy.sections.dataSecurity.body2')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 6 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">6.</span> {t('privacyPolicy.sections.userRights.title')}
            </h2>
            <p>
              {t('privacyPolicy.sections.userRights.intro')}
            </p>
            <ul className="list-disc pl-6 space-y-2">
              {(t('privacyPolicy.sections.userRights.items', { returnObjects: true }) as string[]).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>
              {t('privacyPolicy.sections.userRights.contact.prefix')} <strong>{t('privacyPolicy.sections.userRights.contact.strong1')}</strong> {t('privacyPolicy.sections.userRights.contact.middle')} <strong>{t('privacyPolicy.sections.userRights.contact.strong2')}</strong>{t('privacyPolicy.sections.userRights.contact.suffix')}
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 7 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">7.</span> {t('privacyPolicy.sections.policyChanges.title')}
            </h2>
            <p>
              {t('privacyPolicy.sections.policyChanges.body')}
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0D1B2A] py-10 px-6 text-slate-500 text-sm border-t border-slate-800">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p>{t('shared.footerRights')}</p>
          <div className="flex gap-6 text-xs text-slate-400 font-medium">
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/termos')}>{t('privacyPolicy.footerTermsLink')}</span>
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/')}>{t('shared.footerHome')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
