'use client'
import { Activity, Wifi, WifiOff } from 'lucide-react'

interface HeaderProps {
  currentStep: number
  backendOnline: boolean | null
}

const STEPS = [
  { num: 1, label: 'Load Data',    hint: 'Choose your dataset' },
  { num: 2, label: 'Configure',    hint: 'Set model parameters' },
  { num: 3, label: 'Results',      hint: 'Explore insights' },
]

export default function Header({ currentStep, backendOnline }: HeaderProps) {
  return (
    <header className="bg-ink-900 text-white border-b border-ink-800 px-3 sm:px-6 py-0">
      <div className="max-w-screen-xl mx-auto flex items-stretch gap-4 md:gap-8 min-h-[52px]">

        {/* Brand */}
        <div className="flex items-center gap-3 py-3 shrink-0 pr-4 border-r border-ink-700">
          <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-sm font-bold text-white tracking-tight">MMM Studio</p>
            <p className="text-2xs text-ink-400 font-medium">Google Meridian · Marketing Mix Modeling</p>
          </div>
          <p className="sm:hidden text-sm font-bold text-white">MMM Studio</p>
        </div>

        {/* Step indicator */}
        <nav className="flex items-center gap-0.5 py-2 flex-1 overflow-x-auto scrollbar-none">
          {STEPS.map((step, idx) => {
            const done    = currentStep > step.num
            const active  = currentStep === step.num
            const pending = currentStep < step.num
            return (
              <div key={step.num} className="flex items-center gap-0.5 shrink-0">
                {idx > 0 && (
                  <div className={`h-px w-4 sm:w-6 mx-0.5 ${done || active ? 'bg-brand-500' : 'bg-ink-700'}`} />
                )}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active  ? 'bg-brand-500 text-white'
                    : done  ? 'bg-ink-700/60 text-ink-300'
                    : 'text-ink-500'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      done   ? 'bg-green-500 text-white'
                      : active ? 'bg-white/20 text-white'
                      : 'bg-ink-700 text-ink-500'
                    }`}
                  >
                    {done ? '✓' : step.num}
                  </span>
                  <span className="hidden xs:inline">{step.label}</span>
                  {active && <span className="hidden md:inline text-brand-200 font-normal">— {step.hint}</span>}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Backend status */}
        <div className="flex items-center py-2 pl-4 border-l border-ink-700 shrink-0">
          {backendOnline === null && (
            <span className="text-xs text-ink-500 animate-pulse">checking…</span>
          )}
          {backendOnline === true && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
              <Wifi className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Live backend</span>
              <span className="sm:hidden">Live</span>
            </span>
          )}
          {backendOnline === false && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Demo mode</span>
              <span className="sm:hidden">Demo</span>
            </span>
          )}
        </div>

      </div>
    </header>
  )
}
