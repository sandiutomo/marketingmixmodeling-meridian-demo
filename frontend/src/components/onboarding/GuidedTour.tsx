'use client'
import { useState } from 'react'
import { X, ChevronRight, ChevronLeft, Database, Settings2, TrendingUp, BarChart3, Layers } from 'lucide-react'

const STEPS = [
  {
    icon: BarChart3,
    subtitle: 'Welcome',
    title: 'See what your marketing is actually doing',
    body: 'This platform uses Google Meridian — Google\'s open-source Bayesian MMM framework — to estimate the causal contribution of every channel, including TV and radio. It gives you a confidence range per channel, not just a single number, so you know how much to trust each estimate.',
    tip: null,
  },
  {
    icon: Database,
    subtitle: 'Step 1',
    title: 'Pick a dataset',
    body: 'Choose a sample dataset that fits your setup: multi-region, national, reach & frequency, organic media, or upload your own CSV. The Geographic Data dataset is the best starting point — it has 4 channels and 3 years of weekly data across 20 regions.',
    tip: 'Tip: Expand a card to see which channels are included and preview the first 100 rows.',
  },
  {
    icon: Settings2,
    subtitle: 'Step 2',
    title: 'Configure and run',
    body: 'Set your date range, regions, and channels. Advanced options let you tune carryover windows, prior beliefs per channel, holdout validation, non-revenue KPI mode, and reach & frequency optimization. Apply the configuration, then run the model.',
    tip: 'Tip: Default settings work for most datasets. The generated Python code updates live as you change settings — click "Show generated code" to see exactly what Meridian will run.',
  },
  {
    icon: TrendingUp,
    subtitle: 'Step 3',
    title: 'Explore your results',
    body: 'Six tabs show different views of your model output. Each tab has a "Generate" button that fetches live results from the Meridian posterior — ROI with CI bands, mROI, CPIK, saturation curves, synergy, geo breakdown, and budget optimization.',
    tip: 'Tip: Suggested order — Channel ROI → Budget → Contribution → Scenarios → Synergy → Geography. Export your results as CSV (for Looker Studio) or HTML report from the Export button.',
  },
  {
    icon: Layers,
    subtitle: 'Step 4',
    title: 'Advanced features',
    body: 'Model Diagnostics shows R-hat convergence, prior vs posterior shift, and model fit over time. Scenario Planning lets you save and restore named budget scenarios. The Budget tab supports three optimizer modes: fixed budget, target ROI, and target marginal ROI.',
    tip: 'Tip: Run the model with a real dataset to unlock the Bayesian posterior features — R-hat boxplot, prior/posterior density curves, and Hill saturation parameters.',
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
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-gradient-to-r from-brand-700 to-brand-500' : 'bg-surface-200'}`} />
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
