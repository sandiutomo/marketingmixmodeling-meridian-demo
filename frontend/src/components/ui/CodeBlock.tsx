'use client'
import { useState } from 'react'
import { Copy, CheckCheck } from 'lucide-react'

function renderLine(line: string, i: number) {
  const trimmed = line.trimStart()

  if (trimmed.startsWith('#')) {
    return <span key={i} className="block text-green-400">{line}</span>
  }

  if (/\bprint\s*\(/.test(line)) {
    return <span key={i} className="block text-yellow-300/80">{line}</span>
  }

  const hashIdx = line.indexOf(' #')
  if (hashIdx > 0) {
    return (
      <span key={i} className="block">
        <span className="text-slate-100">{line.slice(0, hashIdx)}</span>
        <span className="text-green-400">{line.slice(hashIdx)}</span>
      </span>
    )
  }

  return <span key={i} className="block text-slate-100">{line}</span>
}

interface CodeBlockProps {
  code: string
  label?: string
}

export default function CodeBlock({ code, label = 'Python · Google Meridian' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-xl border border-surface-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800">
        <span className="text-xs text-slate-400 font-mono">{label}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          {copied ? <><CheckCheck className="w-3.5 h-3.5 text-green-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>
      <pre className="p-4 bg-slate-900 text-xs font-mono overflow-x-auto whitespace-pre">
        {code.split('\n').map((line, i) => renderLine(line, i))}
      </pre>
    </div>
  )
}
