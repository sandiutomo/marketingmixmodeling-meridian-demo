interface PlanningCycleSummaryProps {
  items: string[]
}

export default function PlanningCycleSummary({ items }: PlanningCycleSummaryProps) {
  return (
    <details className="group rounded-xl bg-slate-900 overflow-hidden border-l-4 border-brand-500">
      <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none list-none">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">What to do next</p>
        <span className="text-slate-500 text-xs group-open:hidden">Show</span>
        <span className="text-slate-500 text-xs hidden group-open:inline">Hide</span>
      </summary>
      <ul className="space-y-3 px-5 pb-4">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-slate-200 leading-relaxed">
            <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
            {item}
          </li>
        ))}
      </ul>
    </details>
  )
}
