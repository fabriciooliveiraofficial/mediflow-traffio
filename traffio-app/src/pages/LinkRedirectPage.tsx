import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ExternalLink, Home } from 'lucide-react';
import { shortLinkService } from '../services/shortLinkService';

export function LinkRedirectPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!code) {
      setError('Código de link não fornecido.');
      setLoading(false);
      return;
    }

    const resolveLink = async () => {
      try {
        const link = await shortLinkService.getByCode(code);
        if (link) {
          // Increment clicks asynchronously
          shortLinkService.incrementClicks(code);
          
          // Verify URL protocol, prepend https:// if missing
          let destination = link.original_url.trim();
          if (!/^https?:\/\//i.test(destination)) {
            destination = 'https://' + destination;
          }
          
          // Perform full page redirect
          window.location.replace(destination);
        } else {
          setError('Este link encurtado não foi encontrado ou está desativado.');
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Redirection error:', err);
        setError('Ocorreu um erro ao processar o redirecionamento. Tente novamente.');
        setLoading(false);
      }
    };

    resolveLink();
  }, [code]);

  // Handle countdown redirection to home for 404 errors
  useEffect(() => {
    if (loading || !error) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          navigate('/', { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [loading, error, navigate]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 relative overflow-hidden font-sans">
      {/* Decorative background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 backdrop-blur-xl rounded-3xl p-8 shadow-2xl text-center space-y-6 relative z-10">
        {loading ? (
          <div className="py-8 space-y-5 flex flex-col items-center">
            <div className="relative flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shadow-lg shadow-blue-500/5">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-extrabold tracking-tight text-white">Redirecionando...</h2>
              <p className="text-xs text-slate-400 font-medium">Você está sendo direcionado ao destino seguro.</p>
            </div>
            <span className="text-[10px] font-black tracking-widest text-slate-500 uppercase flex items-center gap-1.5 pt-2">
              ⚡ Mediflow Traffio
            </span>
          </div>
        ) : (
          <div className="py-4 space-y-5 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shadow-lg shadow-rose-500/5">
              <AlertCircle className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-lg font-extrabold tracking-tight text-white">Link Não Encontrado</h2>
              <p className="text-xs text-slate-400 leading-relaxed max-w-[280px] mx-auto">
                {error}
              </p>
            </div>

            <div className="w-full pt-4 border-t border-slate-800 flex flex-col gap-2">
              <button
                onClick={() => navigate('/', { replace: true })}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-600/10 flex items-center justify-center gap-2 border-none cursor-pointer"
              >
                <Home size={14} />
                Ir para o início
              </button>
            </div>

            <p className="text-[10px] text-slate-500 font-bold">
              Redirecionando para a página inicial em {countdown}s...
            </p>
          </div>
        )}
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-slate-600 text-[10px] font-black uppercase tracking-widest">
        © 2026 Mediflow Traffio
      </div>
    </div>
  );
}
