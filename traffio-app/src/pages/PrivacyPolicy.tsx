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
              <p className="text-[10px] text-amber-400 font-bold tracking-wider">{t('legal.shared.brandTagline')}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-amber-400 transition-colors border-none bg-transparent cursor-pointer"
          >
            <ArrowLeft size={16} />
            {t('legal.shared.backToHome')}
          </button>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-[#0D1B2A] text-white py-16 px-6 relative overflow-hidden">
        <div className="absolute -inset-4 bg-gradient-to-tr from-amber-500/10 to-transparent rounded-[40px] blur-3xl opacity-50" />
        <div className="max-w-4xl mx-auto relative z-10 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800/80 border border-slate-700 text-amber-400 rounded-full text-xs font-black uppercase tracking-wider mb-4">
            <ShieldCheck size={14} />
            {t('legal.privacyPolicy.heroBadge')}
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight">
            {t('legal.privacyPolicy.heroTitle')}
          </h1>
          <p className="text-slate-400 text-base font-medium max-w-2xl leading-relaxed">
            {t('legal.privacyPolicy.lastUpdatedLabel')} 15 de junho de 2026. {t('legal.privacyPolicy.heroSubtitle')}
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
              <h3 className="font-bold text-slate-900 text-sm mb-1">Dados Protegidos</h3>
              <p className="text-xs text-slate-500 font-medium">Criptografia de ponta a ponta e segurança rigorosa dos dados da clínica.</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-3"><Eye size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Uso Transparente</h3>
              <p className="text-xs text-slate-500 font-medium">Os dados das APIs do Google Ads e Meta Ads são usados apenas para relatórios.</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mb-3"><Mail size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Controle Total</h3>
              <p className="text-xs text-slate-500 font-medium">Você pode revogar permissões e apagar dados a qualquer momento.</p>
            </div>
          </div>

          {/* Seção 1 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">1.</span> Quem Somos e Escopo
            </h2>
            <p>
              A <strong>Traffio Odonto Marketing</strong> ("Traffio", "nós", "nosso"), operada pelo desenvolvedor responsável <strong>fabriciooliveiraofficial@gmail.com</strong>, é uma plataforma de gestão e automação de marketing para clínicas odontológicas e de saúde. Esta Política de Privacidade descreve como tratamos as informações pessoais e operacionais de nossos usuários ("Clientes", "Clínicas") e dos pacientes das Clínicas que utilizam nossos serviços.
            </p>
            <p>
              Ao utilizar a Traffio, você concorda com a coleta e uso de informações em conformidade com esta política e em estrita consonância com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018).
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 2 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">2.</span> Informações que Coletamos
            </h2>
            <p>Coletamos as seguintes categorias de informações necessárias para fornecer nossos serviços:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Informações de Registro e Conta:</strong> Nome completo, e-mail, telefone, CPF/CNPJ, nome da clínica, especialidades, credenciais de acesso e informações de faturamento.</li>
              <li><strong>Dados Clínicos e de Pacientes (como Operador):</strong> Agenda de consultas, fichas cadastrais de pacientes (nome, e-mail, celular, data de nascimento), históricos de atendimento odontológicos e prontuários que você decide inserir na plataforma.</li>
              <li><strong>Dados de Integração de Terceiros:</strong> Tokens de acesso e dados analíticos quando você integra sua conta Traffio ao Google Ads, Meta Ads (Facebook/Instagram Ads), WhatsApp API ou gateways de pagamento.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 3 - Crítica para o Google OAuth */}
          <section className="space-y-4 bg-amber-50/50 p-6 md:p-8 rounded-3xl border border-amber-100/80">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">3.</span> Integração com a API do Google Ads
            </h2>
            <p className="font-medium text-slate-800">
              A Traffio oferece suporte a integrações opcionais com a API do Google Ads (usando o escopo <code>https://www.googleapis.com/auth/adwords</code>) para consolidação de métricas.
            </p>
            <div className="space-y-4 text-sm mt-3">
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">Finalidade do Acesso aos Dados do Google Ads:</h4>
                  <p className="text-slate-600">
                    Acessamos de forma estritamente <strong>leitura (read-only)</strong> as informações de desempenho de suas campanhas de anúncios, incluindo: valor investido (custo), cliques, impressões e conversões. Esses dados são utilizados exclusivamente para calcular o Retorno sobre Investimento (ROAS), Custo por Lead (CPL) e exibir gráficos consolidados de faturamento e aquisição de pacientes no dashboard da sua conta Traffio.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">Não Compartilhamento de Dados do Google:</h4>
                  <p className="text-slate-600">
                    Não compartilhamos, vendemos, alugamos ou transferimos quaisquer dados obtidos por meio da API do Google Ads com terceiros, sob qualquer circunstância. Os dados permanecem exclusivamente visíveis e restritos ao usuário administrador da clínica que realizou a autenticação.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900">Conformidade com a Política do Google (Limited Use):</h4>
                  <p className="text-slate-600 font-medium">
                    A utilização de informações recebidas das APIs do Google pela Traffio está em estrita conformidade com a <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand-primary underline hover:text-amber-500 transition-colors">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado (Limited Use Requirements).
                  </p>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 4 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">4.</span> Como Compartilhamos Dados
            </h2>
            <p>
              Nós **não vendemos nem alugamos** dados pessoais de nossos clientes ou de seus pacientes. Compartilhamos informações com terceiros somente nas seguintes circunstâncias:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Provedores de Infraestrutura e Serviços:</strong> Provedores de hospedagem na nuvem (Supabase, AWS), gateways de pagamento (Pagar.me, Asaas, Dr. Cash) e serviços de envio de mensagens (WhatsApp API, e-mail transactional), apenas na extensão estritamente necessária para execução do serviço.</li>
              <li><strong>Obrigação Legal:</strong> Para cumprir ordens judiciais, leis aplicáveis ou regulamentações de órgãos competentes.</li>
              <li><strong>Com o seu Consentimento:</strong> Quando você explicitamente autoriza a transferência de dados para outra plataforma através de chaves de API personalizadas.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 5 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">5.</span> Segurança e Armazenamento dos Dados
            </h2>
            <p>
              Empregamos medidas de segurança técnicas e administrativas padrão da indústria para proteger seus dados, tais como criptografia SSL/TLS em trânsito e em repouso, políticas estritas de Row-Level Security (RLS) em nosso banco de dados no Supabase para garantir isolamento completo de tenants (uma clínica não pode ver dados de outra), além de backups diários e logs de auditoria.
            </p>
            <p>
              Os dados coletados são armazenados enquanto o contrato de serviço estiver ativo ou até que o cliente solicite formalmente a exclusão da sua conta.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 6 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">6.</span> Seus Direitos (LGPD) e Exclusão de Dados
            </h2>
            <p>
              Você, como Titular dos Dados, possui plenos direitos previstos no Artigo 18 da LGPD, que incluem:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Confirmar a existência do tratamento de dados.</li>
              <li>Acessar seus dados pessoais.</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
              <li>Revogar a autorização de integrações a qualquer momento (como desconectar o Google Ads da plataforma, o que apaga imediatamente as credenciais armazenadas).</li>
              <li>Solicitar a eliminação definitiva de seus dados cadastrados.</li>
            </ul>
            <p>
              Para exercer qualquer um desses direitos ou solicitar a exclusão total da sua conta e de seus dados associados, entre em contato através de: <strong>fabriciooliveiraofficial@gmail.com</strong> ou pelo e-mail <strong>contato@traffio.com.br</strong>. Sua solicitação será atendida gratuitamente em até 15 dias.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 7 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">7.</span> Alterações nesta Política de Privacidade
            </h2>
            <p>
              Reservamo-nos o direito de atualizar esta política de tempos em tempos. Se realizarmos alterações significativas, notificaremos os usuários através de avisos proeminentes dentro do painel do Traffio ou por e-mail antes que a alteração entre em vigor. Recomendamos a leitura periódica desta página.
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0D1B2A] py-10 px-6 text-slate-500 text-sm border-t border-slate-800">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© 2026 Traffio Odonto Marketing. Todos os direitos reservados.</p>
          <div className="flex gap-6 text-xs text-slate-400 font-medium">
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/termos')}>Termos de Uso</span>
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/')}>Home</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
