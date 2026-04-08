import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataMethodBadge from '@/components/ui/DataMethodBadge'

describe('DataMethodBadge', () => {
  it('renders "Model results" for meridian method', () => {
    render(<DataMethodBadge method="meridian" />)
    expect(screen.getByText('Model results')).toBeInTheDocument()
  })

  it('renders "Estimated" for pearson method', () => {
    render(<DataMethodBadge method="pearson" />)
    expect(screen.getByText('Estimated')).toBeInTheDocument()
  })

  it('renders "Sample data" for mock method', () => {
    render(<DataMethodBadge method="mock" />)
    expect(screen.getByText('Sample data')).toBeInTheDocument()
  })

  it('hides label text in compact mode', () => {
    const { queryByText } = render(<DataMethodBadge method="meridian" compact />)
    expect(queryByText('Model results')).not.toBeInTheDocument()
  })

  it('applies green classes for meridian', () => {
    const { container } = render(<DataMethodBadge method="meridian" />)
    expect(container.firstChild).toHaveClass('bg-green-50')
  })

  it('applies amber classes for pearson', () => {
    const { container } = render(<DataMethodBadge method="pearson" />)
    expect(container.firstChild).toHaveClass('bg-amber-50')
  })

  it('applies slate classes for mock', () => {
    const { container } = render(<DataMethodBadge method="mock" />)
    expect(container.firstChild).toHaveClass('bg-slate-100')
  })
})
