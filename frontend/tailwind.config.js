/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // PostHog design system — full token set
        ph: {
          parchment:        '#fdfdf8',
          'sage-cream':     '#eeefe9',
          'light-sage':     '#e5e7e0',
          'warm-tan':       '#d4c9b8',
          'olive-ink':      '#4d4f46',
          'deep-olive':     '#23251d',
          'muted-olive':    '#65675e',
          'sage-placeholder': '#9ea096',
          'sage-border':    '#bfc1b7',
          orange:           '#F54E00',
          amber:            '#F7A501',
          'dark-cta':       '#1e1f23',
          'hover-white':    '#f4f4f4',
        },
        // Keep brand/surface for backward compat (focus rings, some direct usages)
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#4361ee',
          600: '#3451d1',
          700: '#2741b8',
          900: '#1a2d8a',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f8f9fb',
          100: '#f1f3f7',
          200: '#e4e8f0',
          300: '#d0d6e4',
        },
        success: '#16a34a',
        warning: '#d97706',
        danger:  '#dc2626',
      },
      fontFamily: {
        // IBM Plex Sans Variable via next/font — PostHog's typeface
        sans: ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', '-apple-system', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      // Tabular numbers for data-heavy content
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
      letterSpacing: {
        tightest: '-0.05em',
        tighter:  '-0.03em',
      },
      boxShadow: {
        // PostHog's single floating shadow — reserved for modals/dropdowns
        'ph-float': '0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
        // Subtle card elevation
        'ph-card':  '0 1px 2px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
}
