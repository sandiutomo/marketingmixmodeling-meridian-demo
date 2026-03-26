'use client'
import { useState } from 'react'
import { X, ChevronRight, ChevronLeft, Database, Settings2, TrendingUp, BarChart3 } from 'lucide-react'

const STEPS = [
  {
    icon: BarChart3,
    subtitle: 'Welcome',
    title: 'See how your marketing actually works',
    body: 'This demo shows you Marketing Mix Modeling (MMM) using Google Meridian — an open-source platform built for modern marketing teams. Unlike last-click attribution, MMM measures the real contribution of every channel, including TV and radio, backed by statistical evidence.',
    tip: null,
  },
  {
    icon: Database,
    subtitle: 'Step 1',
    title: 'Pick your dataset',
    body: 'Choose a sample dataset that matches your setup: geographic data, data with reach and frequency tracking, data with organic factors, or simple national data. Click a card to expand it, preview the columns, then click "Load" on the right.',
    tip: 'Tip: Expand a card to preview the first 100 rows and see which channels are included.',
  },
  {
    icon: Settings2,
    subtitle: 'Step 2',
    title: 'Configure and run the model',
    body: 'Set your date range, regions, and channels. Click "Apply Configuration" then "Run Model." The model uses Bayesian statistics to estimate ROI for each channel with confidence ranges, not just single numbers.',
    tip: 'Tip: The default settings work well. You don\'t need to change them for a meaningful result.',
  },
  {
    icon: TrendingUp,
    subtitle: 'Step 3',
    title: 'Explore your insights',
    body: 'Five tabs show different angles: Budget Allocation (ROI per dollar), Measuring True ROI (confidence ranges), Scenario Planning (what-if modeling), Channel Contribution (revenue attribution), and Cross-Channel Impact (how channels amplify each other).',
    tip: 'Tip: Start with Budget Allocation, then Scenario Planning to model a real budget shift.',
  },
]

export default function GuidedTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const Icon = current.icon

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Progress bar */}
        <div className="flex gap-1.5 px-6 pt-5">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-brand-500' : 'bg-surface-200'}`} />
          ))}
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-50 text-brand-600">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide">{current.subtitle}</p>
              <h3 className="font-bold text-slate-900 text-lg leading-tight">{current.title}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-surface-100 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-3 space-y-3">
          <p className="text-sm text-slate-600 leading-relaxed">{current.body}</p>
          {current.tip && (
            <div className="p-3 bg-brand-50 border border-brand-100 rounded-lg">
              <p className="text-xs text-brand-700">{current.tip}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5 pt-3">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-700 disabled:opacity-0 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <span className="text-xs text-slate-400">{step + 1} of {STEPS.length}</span>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} className="btn-primary text-sm gap-1.5">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onClose} className="btn-primary text-sm gap-1.5">
              Get started <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
