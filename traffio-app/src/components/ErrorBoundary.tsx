import { Component, ErrorInfo, ReactNode } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  isChunkError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isChunkError: false,
  }

  public static getDerivedStateFromError(error: Error): State {
    const message = error?.message || ''
    const isChunkError =
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('Importing a module script failed') ||
      message.includes('text/html') ||
      message.includes('Strict MIME type') ||
      message.includes('Loading chunk')

    return {
      hasError: true,
      error,
      isChunkError,
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)

    if (this.state.isChunkError) {
      const lastReload = sessionStorage.getItem('traffio_chunk_error_reload')
      const now = Date.now()
      if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem('traffio_chunk_error_reload', now.toString())
        window.location.reload()
      }
    }
  }

  private handleReload = () => {
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-ice-100 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-black text-graphite-900 mb-2">
              {this.state.isChunkError
                ? 'Atualização da Plataforma Detectada'
                : 'Algo deu errado'}
            </h2>
            <p className="text-sm font-medium text-graphite-500 mb-6 leading-relaxed">
              {this.state.isChunkError
                ? 'Uma nova versão da plataforma foi instalada. Por favor, recarregue para continuar.'
                : 'Ocorreu um erro inesperado. Clique no botão abaixo para recarregar a plataforma.'}
            </p>
            <button
              onClick={this.handleReload}
              className="w-full py-3.5 px-6 bg-brand-primary text-white font-bold rounded-2xl shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw size={18} />
              <span>Recarregar Plataforma</span>
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
