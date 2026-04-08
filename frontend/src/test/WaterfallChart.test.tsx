import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WaterfallChart from '@/components/charts/WaterfallChart'
import type { WaterfallResult } from '@/lib/types'

// Recharts uses ResizeObserver — stub it for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockWaterfall: WaterfallResult = {
  is_real_meridian: false,
  channels: ['TV', 'Social'],
  periods: ['2024-Q1', '2024-Q2'],
  bars: [
    { period: '2024-Q1', channel: 'TV',     delta: 300000, cumulative: 300000, is_baseline: true },
    { period: '2024-Q1', channel: 'Social', delta: 100000, cumulative: 100000, is_baseline: true },
    { period: '2024-Q2', channel: 'TV',     delta:  20000, cumulative: 320000, is_baseline: false },
    { period: '2024-Q2', channel: 'Social', delta: -10000, cumulative:  90000, is_baseline: false },
  ],
}

describe('WaterfallChart', () => {
  it('renders the chart heading', () => {
    render(<WaterfallChart data={mockWaterfall} />)
    expect(screen.getByText(/Revenue change by period/i)).toBeInTheDocument()
  })

  it('shows the DataMethodBadge', () => {
    render(<WaterfallChart data={mockWaterfall} />)
    expect(screen.getByText('Estimated')).toBeInTheDocument()
  })

  it('shows growth/decline legend for multi-period data', () => {
    render(<WaterfallChart data={mockWaterfall} />)
    expect(screen.getByText(/Growth vs prev/i)).toBeInTheDocument()
    expect(screen.getByText(/Decline vs prev/i)).toBeInTheDocument()
  })

  it('shows empty state when no periods', () => {
    render(<WaterfallChart data={{ ...mockWaterfall, periods: [], bars: [] }} />)
    expect(screen.getByText(/No period data available/i)).toBeInTheDocument()
  })

  it('renders channel names in the legend', () => {
    render(<WaterfallChart data={mockWaterfall} />)
    expect(screen.getByText('TV')).toBeInTheDocument()
    expect(screen.getByText('Social')).toBeInTheDocument()
  })

  it('shows single-period description for one period', () => {
    const singlePeriod: WaterfallResult = {
      ...mockWaterfall,
      periods: ['2024-Q1'],
      bars: mockWaterfall.bars.filter(b => b.period === '2024-Q1'),
    }
    render(<WaterfallChart data={singlePeriod} />)
    expect(screen.getByText(/Revenue attribution by channel/i)).toBeInTheDocument()
  })
})
