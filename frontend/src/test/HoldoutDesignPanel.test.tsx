import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HoldoutDesignPanel from '@/components/tabs/HoldoutDesignPanel'
import type { HoldoutDesignResult } from '@/lib/types'

const mockHoldout: HoldoutDesignResult = {
  applicable: true,
  is_real_meridian: false,
  n_geos: 4,
  treatment_geos: ['geo_0', 'geo_2'],
  control_geos: ['geo_1', 'geo_3'],
  assignments: [
    { geo: 'geo_0', group: 'treatment', total_spend: 800000, portfolio_roi: 3.5, rationale: 'High ROI' },
    { geo: 'geo_2', group: 'treatment', total_spend: 600000, portfolio_roi: 2.9, rationale: 'Mid ROI' },
    { geo: 'geo_1', group: 'control',   total_spend: 700000, portfolio_roi: 3.2, rationale: 'High ROI' },
    { geo: 'geo_3', group: 'control',   total_spend: 500000, portfolio_roi: 2.1, rationale: 'Low ROI' },
  ],
  recommended_duration_weeks: 8,
  holdout_pct: 0.5,
  method_note: 'Alternating assignment by portfolio ROI rank.',
}

describe('HoldoutDesignPanel', () => {
  it('renders "not applicable" state for single-geo data', () => {
    render(<HoldoutDesignPanel data={{ ...mockHoldout, applicable: false }} />)
    expect(screen.getByText(/Holdout design needs multiple regions/i)).toBeInTheDocument()
  })

  it('renders the panel heading', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText(/Lift Test Design/i)).toBeInTheDocument()
  })

  it('shows recommended duration weeks', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    // duration is split across text nodes: "{n}" + " weeks"
    const el = screen.getByText((_, node) =>
      node?.textContent?.trim() === '8 weeks'
    )
    expect(el).toBeInTheDocument()
  })

  it('renders treatment geo names', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText('geo_0')).toBeInTheDocument()
    expect(screen.getByText('geo_2')).toBeInTheDocument()
  })

  it('renders control geo names', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText('geo_1')).toBeInTheDocument()
    expect(screen.getByText('geo_3')).toBeInTheDocument()
  })

  it('renders the method note', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText(/Alternating assignment/i)).toBeInTheDocument()
  })

  it('renders treatment count in header', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText(/Treatment regions \(2\)/i)).toBeInTheDocument()
  })

  it('renders control count in header', () => {
    render(<HoldoutDesignPanel data={mockHoldout} />)
    expect(screen.getByText(/Control regions \(2\)/i)).toBeInTheDocument()
  })
})
