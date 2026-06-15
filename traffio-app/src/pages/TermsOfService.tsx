import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scale, Mail, ShieldAlert, CheckCircle, FileText } from 'lucide-react';

export const TermsOfService = () => {
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
              <p className="text-[10px] text-amber-400 font-bold tracking-wider">ODONTO • MARKETING</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-amber-400 transition-colors border-none bg-transparent cursor-pointer"
          >
            <ArrowLeft size={16} />
            Voltar para a Home
          </button>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-[#0D1B2A] text-white py-16 px-6 relative overflow-hidden">
        <div className="absolute -inset-4 bg-gradient-to-tr from-amber-500/10 to-transparent rounded-[40px] blur-3xl opacity-50" />
        <div className="max-w-4xl mx-auto relative z-10 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800/80 border border-slate-700 text-amber-400 rounded-full text-xs font-black uppercase tracking-wider mb-4">
            <Scale size={14} />
            Termos de Uso
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight">
            Termos de Serviço
          </h1>
          <p className="text-slate-400 text-base font-medium max-w-2xl leading-relaxed">
            Última atualização: 15 de junho de 2026. Leia atentamente as condições e regras de utilização de nossa plataforma SaaS antes de continuar.
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
              <h3 className="font-bold text-slate-900 text-sm mb-1">Licença SaaS</h3>
              <p className="text-xs text-slate-500 font-medium">Uso sob modalidade de assinatura mensal/anual recorrente para clínicas.</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-600 mb-3"><ShieldAlert size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Responsabilidade</h3>
              <p className="text-xs text-slate-500 font-medium">Você é o único responsável pelos orçamentos e anúncios do Google/Meta.</p>
            </div>
            <div className="flex flex-col items-center text-center p-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-3"><CheckCircle size={20} /></div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Cancelamento</h3>
              <p className="text-xs text-slate-500 font-medium">Sem multas ou taxas de saída. Cancele e exporte dados quando desejar.</p>
            </div>
          </div>

          {/* Seção 1 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">1.</span> Aceitação dos Termos
            </h2>
            <p>
              Ao criar uma conta ou utilizar a plataforma <strong>Traffio Odonto Marketing</strong> ("Serviço", "Traffio"), você concorda em cumprir e estar legalmente vinculado a estes Termos de Serviço ("Termos"). Se você não concorda com qualquer parte destes Termos, não deverá acessar ou utilizar a plataforma.
            </p>
            <p>
              O desenvolvedor e operador legal deste Serviço pode ser contactado pelo e-mail oficial de auditoria da conta Google: <strong>fabriciooliveiraofficial@gmail.com</strong> ou pelo e-mail geral de contato <strong>contato@traffio.com.br</strong>.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 2 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">2.</span> Descrição do Serviço e Concessão de Licença
            </h2>
            <p>
              A Traffio é uma plataforma baseada em nuvem (SaaS) projetada para auxiliar clínicas odontológicas e profissionais de saúde na gestão de consultas (agenda), prontuários eletrônicos de pacientes, envio de lembretes via API do WhatsApp, CRM de leads e consolidação de métricas financeiras e de campanhas publicitárias.
            </p>
            <p>
              Sujeito ao pagamento pontual das taxas de assinatura, concedemos a você uma licença limitada, revogável, não exclusiva, intransferível e mundial para acessar e utilizar a Traffio de acordo com estes Termos. A plataforma é licenciada, não vendida.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 3 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">3.</span> Contas e Segurança do Usuário
            </h2>
            <p>
              Para acessar os recursos da Traffio, você deve criar uma conta de usuário vinculada a um tenant (empresa/clínica). Você declara que as informações cadastrais fornecidas são verídicas, completas e atualizadas.
            </p>
            <p>
              Você é o único responsável por manter a confidencialidade das credenciais de acesso da sua conta e por todas as atividades realizadas sob seu login. É vedado compartilhar suas credenciais com terceiros não autorizados. Notifique-nos imediatamente sobre qualquer uso não autorizado ou suspeita de violação de segurança.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 4 */}
          <section className="space-y-4 bg-amber-50/50 p-6 md:p-8 rounded-3xl border border-amber-100/80">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">4.</span> Integração de Serviços de Terceiros e APIs
            </h2>
            <p>
              A Traffio disponibiliza conectores com serviços terceiros, incluindo a <strong>Google Ads API</strong> e <strong>Meta Ads API</strong>. Ao utilizar essas integrações:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-sm text-slate-600">
              <li><strong>Autorização de Acesso:</strong> Você autoriza a Traffio a acessar e importar dados analíticos de sua conta publicitária (custos, cliques, exibições, etc.) com a finalidade exclusiva de consolidação no seu painel da Traffio.</li>
              <li><strong>Responsabilidade do Usuário:</strong> Você reconhece que todas as campanhas de anúncios, orçamentos, cobranças e políticas são de sua exclusiva responsabilidade e são faturadas diretamente pelas respectivas plataformas (Google LLC e Meta Platforms, Inc.). A Traffio não possui gerência sobre faturas ou orçamentos desses provedores.</li>
              <li><strong>Uso Limitado do Google:</strong> Declaramos que o uso dos dados obtidos a partir de qualquer API do Google está sujeito a restrições estritas de uso e cumpre integralmente a Política de Dados do Usuário dos Serviços de API do Google, não sendo utilizados para quaisquer fins que não sejam o fornecimento dos relatórios internos da Traffio.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 5 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">5.</span> Assinatura, Cobrança e Reajuste
            </h2>
            <p>
              O acesso à plataforma Traffio é faturado periodicamente (mensal ou anualmente, conforme escolha no plano).
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Período de Testes (Trial):</strong> Oferecemos 14 dias de acesso de teste gratuito sem fidelidade. Se você não cancelar antes do término deste período, o faturamento automático será iniciado no meio de pagamento cadastrado.</li>
              <li><strong>Cancelamento:</strong> Você pode cancelar sua assinatura a qualquer momento através da página de faturamento do sistema. Não há multas ou período mínimo de permanência. Ao cancelar, o serviço continuará ativo até o final do período já pago.</li>
              <li><strong>Inadimplência:</strong> A falta de pagamento suspenderá automaticamente o acesso à plataforma em até 5 dias após o vencimento não liquidado.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 6 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">6.</span> Limitação de Responsabilidade
            </h2>
            <p>
              A Traffio e seus desenvolvedores não se responsabilizam por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo, sem limitação, perda de lucros, dados, uso, aviamento ou outras perdas intangíveis decorrentes de:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Seu acesso, uso ou incapacidade de acessar ou utilizar o Serviço.</li>
              <li>Instabilidade no tráfego de mensagens do WhatsApp, que depende de APIs externas de terceiros.</li>
              <li>Erros de configuração ou interrupções nos serviços de anúncios do Google Ads ou Facebook Ads.</li>
              <li>Acesso não autorizado, uso ou alteração de suas transmissões ou dados.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Seção 7 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <span className="text-amber-500">7.</span> Alterações nos Termos e Jurisdição
            </h2>
            <p>
              Reservamo-nos o direito de alterar estes Termos a qualquer momento. Em caso de mudanças materiais, publicaremos um aviso prévio no painel da plataforma. O uso continuado da plataforma após a data de vigência dos novos Termos constitui aceitação dos termos revisados.
            </p>
            <p>
              Estes Termos são regidos e interpretados de acordo com as leis da República Federativa do Brasil, elegendo-se o foro da comarca da sede do desenvolvedor/operador para dirimir quaisquer litígios relativos a estes Termos.
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0D1B2A] py-10 px-6 text-slate-500 text-sm border-t border-slate-800">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© 2026 Traffio Odonto Marketing. Todos os direitos reservados.</p>
          <div className="flex gap-6 text-xs text-slate-400 font-medium">
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/privacidade')}>Política de Privacidade</span>
            <span className="cursor-pointer hover:text-white transition-colors" onClick={() => navigate('/')}>Home</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
