import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Marketing Mix Modeling | Meridian Demo',
  description: 'Understand where your marketing budget creates the most impact',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased touch-manipulation">{children}</body>
    </html>
  )
}
