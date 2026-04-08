'use client'
import { useState } from 'react'
import { Copy, CheckCheck, Maximize2, X } from 'lucide-react'

// ── Syntax highlighting ───────────────────────────────────────────────────────

type Token = { text: string; cls: string }

// Master regex — order matters: strings first, then object refs, then keywords, then numbers
const MASTER_RE = /(["'](?:[^"'\\]|\\.)*["'])|(\b(?:model|analyzer|builder|mmm|rhat_df|acc_ds|ess|az)\.)(\w*)|(\b(?:from|import|def|for|in|if|return|as|with|class|and|or|not|True|False|None|print|float|int)\b)|(\b\d+(?:\.\d+)?\b)/g

function tokenizeLine(line: string): Token[] {
  const trimmed = line.trimStart()

  // Full-line comment
  if (trimmed.startsWith('#')) {
    return [{ text: line, cls: 'text-green-400' }]
  }

  // Split at inline comment (' #')
  const hashIdx = line.indexOf(' #')
  const codePart    = hashIdx > 0 ? line.slice(0, hashIdx) : line
  const commentPart = hashIdx > 0 ? line.slice(hashIdx)    : ''

  const tokens: Token[] = []
  MASTER_RE.lastIndex = 0
  let lastIdx = 0
  let m: RegExpExecArray | null

  while ((m = MASTER_RE.exec(codePart)) !== null) {
    if (m.index > lastIdx) tokens.push({ text: codePart.slice(lastIdx, m.index), cls: 'text-slate-100' })
    if (m[1]) {
      tokens.push({ text: m[1], cls: 'text-amber-300' })          // string literal
    } else if (m[2]) {
      tokens.push({ text: m[2], cls: 'text-blue-300' })           // object name + dot
      if (m[3]) tokens.push({ text: m[3], cls: 'text-slate-200' }) // method name
    } else if (m[4]) {
      tokens.push({ text: m[4], cls: 'text-purple-400' })         // keyword
    } else if (m[5]) {
      tokens.push({ text: m[5], cls: 'text-cyan-300' })           // number
    }
    lastIdx = m.index + m[0].length
  }

  if (lastIdx < codePart.length) tokens.push({ text: codePart.slice(lastIdx), cls: 'text-slate-100' })
  if (commentPart)               tokens.push({ text: commentPart, cls: 'text-green-400' })

  return tokens.length ? tokens : [{ text: line, cls: 'text-slate-100' }]
}

// ── Section parsing ───────────────────────────────────────────────────────────

type Section = { header: string | null; lines: string[]; firstLineNum: number }

function parseSections(code: string): Section[] {
  const rawLines = code.split('\n')
  const sections: Section[] = []
  let prev = { wasBlank: true }

  rawLines.forEach((line, idx) => {
    const isBlank   = line.trim() === ''
    const isComment = !isBlank && line.trimStart().startsWith('#')

    if (isComment && prev.wasBlank && idx > 0) {
      // Start a new collapsible section
      sections.push({ header: line, lines: [], firstLineNum: idx + 1 })
    } else {
      if (sections.length === 0) {
        sections.push({ header: null, lines: [line], firstLineNum: idx + 1 })
      } else {
        sections[sections.length - 1].lines.push(line)
      }
    }
    prev.wasBlank = isBlank
  })

  return sections
}

// ── Line renderer ─────────────────────────────────────────────────────────────

function CodeLine({ line, lineNum }: { line: string; lineNum: number }) {
  const tokens = tokenizeLine(line)
  return (
    <div className="flex">
      <span className="select-none w-10 shrink-0 pr-3 text-right text-slate-600 font-mono">{lineNum}</span>
      <span className="flex-1 whitespace-pre">
        {tokens.map((t, i) => (
          <span key={i} className={t.cls}>{t.text}</span>
        ))}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string
  label?: string
}

function CodeBlockInner({ code, label = 'Generated Python \u2014 google-meridian 1.5.3' }: CodeBlockProps) {
  const [copied, setCopied]             = useState(false)
  const [collapsed, setCollapsed]       = useState<Record<number, boolean>>({})
  const [fullscreen, setFullscreen]     = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const sections = parseSections(code)

  let lineCounter = 1

  const rendered = sections.map((sec, si) => {
    const isCollapsed  = !!collapsed[si]
    const headerLineNum = lineCounter

    // Header line number only counts if header exists
    if (sec.header !== null) lineCounter++

    const bodyLineNums = sec.lines.map(() => lineCounter++)

    return (
      <div key={si}>
        {sec.header !== null && (
          <button
            type="button"
            onClick={() => setCollapsed(p => ({ ...p, [si]: !p[si] }))}
            className="flex items-center w-full text-left hover:bg-slate-800/60 transition-colors group border-t border-slate-700/50 first:border-t-0"
          >
            <span className="select-none w-10 shrink-0 pr-3 text-right text-slate-600 font-mono text-xs">{headerLineNum}</span>
            <span className="flex-1 whitespace-pre text-xs font-mono">
              <span className="text-green-400">{sec.header}</span>
              <span className="ml-2 text-slate-600 text-[10px] group-hover:text-slate-400 transition-colors">
                {isCollapsed ? '▶ expand' : '▼ collapse'}
              </span>
            </span>
          </button>
        )}
        {!isCollapsed && sec.lines.map((line, li) => (
          <CodeLine key={li} line={line} lineNum={bodyLineNums[li]} />
        ))}
      </div>
    )
  })

  return (
    <div className="rounded-xl border border-surface-200 overflow-hidden text-xs font-mono">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-xs text-green-400 font-semibold shrink-0">Live</span>
          <span className="text-xs text-slate-400 font-mono truncate">{label}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            title="Open fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            {copied
              ? <><CheckCheck className="w-3.5 h-3.5 text-green-400" /> Copied!</>
              : <><Copy className="w-3.5 h-3.5" /> Copy</>
            }
          </button>
        </div>
      </div>

      {/* Code body */}
      <div className="p-4 bg-slate-900 overflow-x-auto leading-5">
        {rendered}
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setFullscreen(false)}>
          <div className="w-full max-w-5xl rounded-xl overflow-hidden border border-slate-700 shadow-2xl" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-xs text-green-400 font-semibold">Live</span>
                <span className="text-xs text-slate-400 font-mono">{label}</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                  {copied ? <><CheckCheck className="w-3.5 h-3.5 text-green-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
                <button onClick={() => setFullscreen(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 bg-slate-900 overflow-auto leading-5 text-xs font-mono" style={{ maxHeight: 'calc(90vh - 40px)' }}>
              {rendered}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CodeBlock(props: CodeBlockProps) {
  return <CodeBlockInner {...props} />
}
