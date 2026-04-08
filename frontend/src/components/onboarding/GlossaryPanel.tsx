'use client'
import { useState } from 'react'
import { X, BookOpen } from 'lucide-react'

const TERMS = [
  {
    term: 'Marketing Mix Modeling (MMM)',
    definition: 'A statistical technique that uses historical spend and revenue data to estimate the true contribution of each marketing channel, including offline channels like TV and radio that standard attribution tools cannot measure.',
  },
  {
    term: 'Incremental Revenue',
    definition: 'Revenue that only happened because of your advertising. If you had spent $0 on TV, would those sales still have occurred? The portion that would not have happened is the increment.',
  },
  {
    term: 'Base Revenue',
    definition: 'Revenue your business generates without any advertising, driven by brand equity, word-of-mouth, loyal customers, and seasonality. In this model, roughly 15% of total revenue is base revenue.',
  },
  {
    term: 'ROI (Return on Investment)',
    definition: 'Incremental revenue generated per dollar spent on a channel. An ROI of $4.20 means every $1 in Paid Search drove $4.20 in incremental revenue that would not have occurred otherwise.',
  },
  {
    term: 'Confidence Interval',
    definition: 'The range within which the true ROI likely falls. A 90% confidence interval of $3.50 to $5.10 means the model is 90% certain the real ROI is within that range. Wider ranges mean less certainty and less reliability for major budget decisions.',
  },
  {
    term: 'Adstock / Carryover',
    definition: 'The delayed effect of advertising. When a TV ad airs, part of its impact carries into future weeks as viewers gradually recall and act on it. TV typically carries 20-30% of its impact into the following weeks.',
  },
  {
    term: 'Diminishing Returns',
    definition: 'As you increase spend on a channel, each additional dollar produces less incremental revenue. Doubling your TV budget rarely doubles TV-driven revenue because you start reaching audiences who have already seen your ads.',
  },
  {
    term: 'Saturation Point',
    definition: 'The spend level at which adding more budget to a channel stops producing meaningful returns. The saturation curve shows this visually — the curve flattens as spend increases beyond this point.',
  },
  {
    term: 'Reach and Frequency',
    definition: 'Reach is the percentage of your target audience that sees an ad at least once. Frequency is how many times each person sees it on average. High reach builds awareness. High frequency risks ad fatigue.',
  },
  {
    term: 'Media Attribution',
    definition: 'The process of assigning credit for a sale to the marketing touchpoints that influenced it. Last-click gives all credit to the final touchpoint. MMM distributes credit across all channels based on statistical evidence.',
  },
  {
    term: 'MCMC (Markov Chain Monte Carlo)',
    definition: 'The statistical engine Meridian uses to estimate ROI. Rather than producing one single answer, it runs thousands of simulations to find a range of plausible values — which is why results include confidence intervals rather than point estimates.',
  },
  {
    term: 'R-hat (Convergence Diagnostic)',
    definition: 'A measure of whether the MCMC simulation stabilized on a reliable answer. Values below 1.05 are considered strong. A high R-hat means the model needs more iterations before the results can be trusted.',
  },
  {
    term: 'Budget Optimization',
    definition: 'Using MMM results to find the allocation across channels that maximizes revenue within a fixed total spend. The optimizer can identify a channel split that outperforms the current plan without increasing overall spend.',
  },
  {
    term: 'Channel Synergy',
    definition: 'The additional revenue lift that occurs when two channels run together, beyond what each would generate independently. TV and Paid Search running in the same weeks typically produces 15-20% more conversions than either channel alone.',
  },
]

export default function GlossaryPanel() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = TERMS.filter(t =>
    t.term.toLowerCase().includes(search.toLowerCase()) ||
    t.definition.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        title="Open MMM glossary"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3 py-2.5 bg-white border border-surface-200 rounded-xl shadow-lg text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 transition-all"
      >
        <BookOpen className="w-4 h-4" />
        <span className="font-medium">Glossary</span>
      </button>

      {/* Slide-out panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          <div className="w-full max-w-sm bg-white h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-brand-500" />
                <h3 className="font-bold text-slate-900">Glossary</h3>
                <span className="text-xs text-slate-400">{TERMS.length} terms</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-100">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-surface-100 shrink-0">
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {filtered.map(({ term, definition }) => (
                <div key={term}>
                  <p className="text-sm font-semibold text-slate-900">{term}</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{definition}</p>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No results</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
