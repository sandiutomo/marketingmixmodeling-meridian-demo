'use client'
import { Database, AlertTriangle, RefreshCw } from 'lucide-react'

interface EmptyStateProps {
  type?: 'no-data' | 'error' | 'loading'
  title?: string
  message?: string
  onRetry?: () => void
}

export default function EmptyState({
  type = 'no-data',
  title,
  message,
  onRetry,
}: EmptyStateProps) {
  const defaults = {
    'no-data': {
      icon: Database,
      iconCls: 'text-slate-300',
      title: title ?? 'No data loaded yet',
      message: message ?? 'Load a dataset and run the model to see results here.',
    },
    error: {
      icon: AlertTriangle,
      iconCls: 'text-amber-400',
      title: title ?? 'Could not load results',
      message: message ?? 'The backend may be unavailable. Check that the server is running on port 8001.',
    },
    loading: {
      icon: RefreshCw,
      iconCls: 'text-brand-400 animate-spin',
      title: title ?? 'Loading…',
      message: message ?? 'Fetching results from the model.',
    },
  }[type]

  const Icon = defaults.icon

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <Icon className={`w-8 h-8 ${defaults.iconCls}`} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-500">{defaults.title}</p>
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed">{defaults.message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}
