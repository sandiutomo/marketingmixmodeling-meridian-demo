import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SaturationHeatmap from '@/components/charts/SaturationHeatmap'
import type { SaturationResult } from '@/lib/types'

const mockSaturationData: SaturationResult = {
  is_real_meridian: false,
  channels: [
    {
      channel: 'TV',
      channel_key: 'tv',
      current_spend: 150000,
      ec: 100000,
      saturation_ratio: 1.5,
      marginal_roi: 0.8,
      roi: 2.8,
      status: 'saturated',
      is_real_meridian: false,
    },
    {
      channel: 'Paid Search',
      channel_key: 'paid_search',
      current_spend: 50000,
      ec: 120000,
      saturation_ratio: 0.42,
      marginal_roi: 3.5,
      roi: 4.2,
      status: 'room_to_grow',
      is_real_meridian: false,
    },
    {
      channel: 'Social',
      channel_key: 'social',
      current_spend: 80000,
      ec: 90000,
      saturation_ratio: 0.89,
      marginal_roi: 2.1,
      roi: 3.1,
      status: 'efficient',
      is_real_meridian: false,
    },
  ],
}

describe('SaturationHeatmap', () => {
  it('renders a row for each channel', () => {
    render(<SaturationHeatmap data={mockSaturationData} />)
    expect(screen.getByText('TV')).toBeInTheDocument()
    expect(screen.getByText('Paid Search')).toBeInTheDocument()
    expect(screen.getByText('Social')).toBeInTheDocument()
  })

  it('shows empty state when no channels', () => {
    render(<SaturationHeatmap data={{ ...mockSaturationData, channels: [] }} />)
    expect(screen.getByText(/Run the model/i)).toBeInTheDocument()
  })

  it('renders the DataMethodBadge', () => {
    render(<SaturationHeatmap data={mockSaturationData} />)
    expect(screen.getByText('Estimated')).toBeInTheDocument()
  })

  it('renders meridian badge for real meridian data', () => {
    render(<SaturationHeatmap data={{ ...mockSaturationData, is_real_meridian: true }} />)
    expect(screen.getByText('Model results')).toBeInTheDocument()
  })

  it('shows all column headers', () => {
    render(<SaturationHeatmap data={mockSaturationData} />)
    // "Monthly Spend" appears in both a th and the footnote — check at least one exists
    expect(screen.getAllByText(/Monthly Spend/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Sat\. ratio/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Status/i).length).toBeGreaterThan(0)
  })
})
