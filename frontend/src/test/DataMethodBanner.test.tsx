import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataMethodBanner from '@/components/ui/DataMethodBanner'

describe('DataMethodBanner', () => {
  it('shows model results text for meridian method', () => {
    render(<DataMethodBanner method="meridian" />)
    expect(screen.getByText(/MODEL RESULTS/i)).toBeInTheDocument()
  })

  it('shows estimated results warning for pearson method', () => {
    render(<DataMethodBanner method="pearson" />)
    expect(screen.getByText(/ESTIMATED RESULTS/i)).toBeInTheDocument()
  })

  it('shows sample data notice for mock method', () => {
    render(<DataMethodBanner method="mock" />)
    expect(screen.getByText(/SAMPLE DATA/i)).toBeInTheDocument()
  })

  it('applies green background for meridian', () => {
    const { container } = render(<DataMethodBanner method="meridian" />)
    expect(container.firstChild).toHaveClass('bg-green-50')
  })

  it('applies amber background for pearson', () => {
    const { container } = render(<DataMethodBanner method="pearson" />)
    expect(container.firstChild).toHaveClass('bg-amber-50')
  })

  it('applies slate background for mock', () => {
    const { container } = render(<DataMethodBanner method="mock" />)
    expect(container.firstChild).toHaveClass('bg-slate-50')
  })
})
