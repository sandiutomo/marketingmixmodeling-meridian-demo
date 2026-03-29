'use client'
import { BarChart3, Wifi } from 'lucide-react'

interface HeaderProps {
  currentStep: number
  backendOnline: boolean | null
}

const steps = [
  { num: 1, label: 'Data' },
  { num: 2, label: 'Model' },
  { num: 3, label: 'Insights' },
]

export default function Header({ currentStep, backendOnline }: HeaderProps) {
  return (
    <header className="bg-white border-b border-surface-200 px-3 sm:px-6 py-3 sm:py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between max-w-screen-xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 text-brand-600 min-w-0">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
            <span className="text-base sm:text-lg font-bold text-slate-900 truncate">Marketing Mix Model Studio</span>
          </div>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="text-xs sm:text-sm text-slate-500 truncate">Google Meridian</span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 -mx-1 px-1 scrollbar-thin">
          {steps.map((step) => (
            <div key={step.num} className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              <div
                className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
                  currentStep === step.num
                    ? 'bg-brand-500 text-white'
                    : currentStep > step.num
                      ? 'bg-green-100 text-green-700'
                      : 'bg-surface-100 text-slate-400'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    currentStep > step.num ? 'bg-green-500 text-white' : 'bg-white/30'
                  }`}
                >
                  {currentStep > step.num ? '✓' : step.num}
                </span>
                <span className="hidden xs:inline">{step.label}</span>
              </div>
              {step.num < 3 && <div className="w-2 sm:w-4 h-px bg-surface-200 hidden sm:block" />}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2 text-[11px] sm:text-xs shrink-0">
          {backendOnline === null && <span className="text-slate-400">Checking…</span>}
          {backendOnline === true && (
            <span className="flex items-center gap-1 text-green-600 font-medium">
              <Wifi className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Backend</span> online
            </span>
          )}
          {backendOnline === false && <span className="text-amber-600 font-medium">Demo mode</span>}
        </div>
      </div>
    </header>
  )
}
