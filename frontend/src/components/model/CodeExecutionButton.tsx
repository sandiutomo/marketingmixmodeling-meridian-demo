'use client'
import { useState, useRef } from 'react'
import { Play, Code2, CheckCheck, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
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
  /** Real backend progress (0–100). When provided, drives the in-button gradient
   *  instead of the client-side fake ticker. */
  externalProgress?: number | null
  /** Status text shown inside the button while running (replaces "Running…"). */
  statusText?: string | null
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
  externalProgress,
  statusText,
}: CodeExecutionButtonProps) {
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(false)
  const [executed, setExecuted] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [fakeProgress, setFakeProgress] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setDone(false)
    setFakeProgress(0)

    // Only run fake ticker when no real external progress is wired up
    if (externalProgress == null) {
      intervalRef.current = setInterval(() => {
        setFakeProgress(p => {
          if (p >= 85) return p
          const inc = p < 40 ? 4 : p < 65 ? 2 : 0.8
          return Math.min(p + inc + Math.random() * 1.5, 85)
        })
      }, 180)
    }

    try {
      await onExecute()
      if (intervalRef.current) clearInterval(intervalRef.current)
      setFakeProgress(100)
      setDone(true)
      setExecuted(true)
      setTimeout(() => { setDone(false); setFakeProgress(0) }, 2500)
    } catch (e: unknown) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setFakeProgress(0)
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setRunning(false)
    }
  }

  // Real backend progress takes priority over client-side fake ticker
  const displayProgress = (running && externalProgress != null)
    ? externalProgress
    : fakeProgress

  // Settled state: deep olive after execution
  const btnStyle = executed
    ? { background: 'var(--color-deep-olive)', color: '#ffffff', borderRadius: '6px' }
    : undefined

  const btnClass = executed
    ? 'flex items-center gap-2 px-[14px] py-2 text-sm font-medium text-white transition-all active:scale-[0.97]'
    : variant === 'primary' ? 'btn-primary' : 'btn-secondary'

  // In-button gradient sweep
  const progressGradient = executed
    ? 'linear-gradient(to right, #111310, #2e3327, #4d4f46)'
    : 'linear-gradient(to right, #1e1f23, #8a2c00, #F54E00)'

  // Label shown while running — status text from backend if available
  const runningLabel = statusText || 'Running…'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-6">

        <button
          onClick={handleRun}
          disabled={disabled || running}
          className={`${btnClass} flex-1 justify-center relative overflow-hidden`}
          style={btnStyle}
        >
          {/* Gradient fill — the only progress indicator */}
          {(running || displayProgress > 0) && (
            <div
              className="absolute inset-y-0 left-0 transition-all duration-300 ease-out"
              style={{ width: `${displayProgress}%`, background: progressGradient }}
            />
          )}

          <span className="relative z-10 flex items-center gap-2 min-w-0">
            {running
              ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              : done
              ? <CheckCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--color-amber)' }} />
              : <Play className="w-4 h-4 shrink-0" />
            }
            {/* Status text truncates gracefully when backend messages are long */}
            <span className="truncate">
              {running ? runningLabel : done ? successMessage : label}
            </span>
          </span>
        </button>

        <button
          onClick={() => setShowCode(!showCode)}
          className="btn-secondary gap-1.5 text-xs shrink-0"
        >
          <Code2 className="w-3.5 h-3.5" />
          {showCode ? 'Hide generated code' : 'Show generated code'}
          {showCode ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

      </div>

      {showCode && <CodeBlock code={code} />}

      {error && (
        <div
          className="px-4 py-3 rounded text-sm"
          style={{
            background: '#fff5f5',
            border: '1px solid #fca5a5',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
