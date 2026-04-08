'use client'
import { BarChart3, Wifi } from 'lucide-react'

interface HeaderProps {
  currentStep: number
  backendOnline: boolean | null
}

const steps = [
  { num: 1, label: 'Choose data' },
  { num: 2, label: 'Run model' },
  { num: 3, label: 'View results' },
]

export default function Header({ currentStep, backendOnline }: HeaderProps) {
  return (
    <header
      className="px-3 sm:px-6 py-3 sm:py-4"
      style={{
        background: 'var(--color-parchment)',
        borderBottom: '1px solid var(--color-sage-border)',
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between max-w-screen-xl mx-auto">

        {/* Logo + wordmark */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3
              className="w-5 h-5 sm:w-5 sm:h-5 shrink-0"
              style={{ color: 'var(--color-orange)' }}
            />
            <span
              className="text-base sm:text-[15px] font-bold truncate tracking-tight"
              style={{ color: 'var(--color-deep-olive)' }}
            >
              Marketing Mix Model Studio
            </span>
          </div>
          <span
            className="hidden sm:inline text-[11px] font-medium px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--color-sage-cream)',
              color: 'var(--color-sage-placeholder)',
              border: '1px solid var(--color-sage-border)',
            }}
          >
            Google Meridian
          </span>
        </div>

        {/* Step progress */}
        <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 -mx-1 px-1">
          {steps.map((step, idx) => {
            const isActive    = currentStep === step.num
            const isComplete  = currentStep > step.num
            const isInactive  = currentStep < step.num

            return (
              <div key={step.num} className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <div
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs font-medium transition-all"
                  style={
                    isActive
                      ? { background: 'var(--color-dark-cta)', color: '#ffffff' }
                      : isComplete
                      ? { background: 'var(--color-sage-cream)', color: 'var(--color-deep-olive)', border: '1px solid var(--color-sage-border)' }
                      : { background: 'var(--color-light-sage)', color: 'var(--color-sage-placeholder)' }
                  }
                >
                  {/* Step number / check */}
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                    style={
                      isActive
                        ? { background: 'rgba(255,255,255,0.15)', color: '#ffffff' }
                        : isComplete
                        ? { background: 'var(--color-orange)', color: '#ffffff' }
                        : { background: 'var(--color-sage-border)', color: 'var(--color-parchment)' }
                    }
                  >
                    {isComplete ? '✓' : step.num}
                  </span>
                  <span className="hidden xs:inline">{step.label}</span>
                </div>

                {/* Connector */}
                {idx < steps.length - 1 && (
                  <div
                    className="w-3 sm:w-5 h-px hidden sm:block"
                    style={{ background: 'var(--color-sage-border)' }}
                  />
                )}
              </div>
            )
          })}
        </nav>

        {/* Backend status */}
        <div className="flex items-center gap-2 text-xs shrink-0 font-medium">
          {backendOnline === null && (
            <span style={{ color: 'var(--color-sage-placeholder)' }}>Connecting…</span>
          )}
          {backendOnline === true && (
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded"
              style={{
                background: 'var(--color-sage-cream)',
                color: 'var(--color-deep-olive)',
                border: '1px solid var(--color-sage-border)',
              }}
            >
              <Wifi className="w-3 h-3" style={{ color: 'var(--color-orange)' }} />
              Live data
            </span>
          )}
          {backendOnline === false && (
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded"
              style={{
                background: 'var(--color-light-sage)',
                color: 'var(--color-muted-olive)',
                border: '1px solid var(--color-sage-border)',
              }}
            >
              Sample data
            </span>
          )}
        </div>

      </div>
    </header>
  )
}
