'use client'
import { useState, ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

export default function SectionTooltip({ content }: { content: ReactNode }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative inline-flex shrink-0">
      <HelpCircle
        className="w-4 h-4 text-slate-300 hover:text-slate-500 cursor-help transition-colors"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      />
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-800 text-slate-100 rounded-xl shadow-2xl z-50 text-xs leading-relaxed pointer-events-none">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  )
}