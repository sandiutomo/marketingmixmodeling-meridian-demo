'use client'
import { useState } from 'react'
import { Play, Code2, CheckCheck, ChevronDown, ChevronUp, Loader2, HelpCircle } from 'lucide-react'
import CodeBlock from '@/components/ui/CodeBlock'

interface CodeExecutionButtonProps {
  label: string
  tooltip: string
  whyItMatters: string
  code: string
  onExecute: () => Promise<void>
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  successMessage?: string
}

export default function CodeExecutionButton({
  label,
  tooltip,
  whyItMatters,
  code,
  onExecute,
  disabled = false,
  variant = 'primary',
  successMessage = 'Done!',
}: CodeExecutionButtonProps) {
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setDone(false)
    try {
      await onExecute()
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setRunning(false)
    }
  }

  const btnClass = variant === 'primary' ? 'btn-primary' : 'btn-secondary'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleRun}
          disabled={disabled || running}
          className={`${btnClass} ${(disabled || running) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <CheckCheck className="w-4 h-4 text-green-400" /> : <Play className="w-4 h-4" />}
          {running ? 'Running...' : done ? successMessage : label}
        </button>

        <button
          onClick={() => setShowCode(!showCode)}
          className="btn-secondary gap-1.5 text-xs"
        >
          <Code2 className="w-3.5 h-3.5" />
          {showCode ? 'Hide code' : 'View code'}
          {showCode ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        <div className="relative group">
          <HelpCircle className="w-4 h-4 text-slate-300 hover:text-slate-500 cursor-help transition-colors" />
          <div className="absolute bottom-full left-0 mb-2 w-72 p-3 bg-slate-800 text-slate-100 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
            <p className="font-semibold text-white text-sm mb-1">{label}</p>
            <p className="text-slate-300 text-xs mb-2.5">{tooltip}</p>
            <div className="border-t border-slate-700 pt-2.5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Why it matters</p>
              <p className="text-slate-300 text-xs">{whyItMatters}</p>
            </div>
            <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-800" />
          </div>
        </div>
      </div>

      {showCode && <CodeBlock code={code} />}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
