/**
 * FraudLens design tokens — light theme with a liquid-glass surface treatment.
 *
 * The canvas is a soft tinted off-white rather than pure white, with slow
 * colour fields behind it. Panels are translucent and blurred, so they pick up
 * that colour as they move over it — which is what makes the glass read as
 * glass rather than as a grey box with a border.
 *
 * Status colour is defined once here and referenced everywhere, so "high risk"
 * looks identical on a table row, a chart segment and a graph node. The risk
 * palette is deliberately darker than its dark-theme equivalent: a pastel red
 * on a light surface fails contrast for text.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /** Page background. Tinted, never pure white. */
        canvas: {
          DEFAULT: '#eef0f8',
          deep: '#e4e7f3',
        },
        /**
         * Opaque surfaces layered above the glass: inputs, hover states,
         * skeletons. Glass panels themselves use `bg-white/…` plus blur.
         */
        surface: {
          DEFAULT: '#ffffff',
          2: '#f4f6fc',
          3: '#e8ebf5',
        },
        /** Hairlines. Mostly used at partial opacity over glass. */
        line: {
          DEFAULT: '#dde2ef',
          2: '#c7cee2',
          3: '#a9b2cb',
        },
        /** Foreground text. */
        fg: {
          DEFAULT: '#151830',
          muted: '#525a79',
          faint: '#858da9',
        },
        accent: {
          DEFAULT: '#5b5bd6',
          soft: '#7b7bf0',
          dim: '#4040b5',
          wash: 'rgba(91, 91, 214, 0.10)',
        },
        risk: {
          low: '#047857',
          medium: '#b45309',
          high: '#dc2626',
          critical: '#9f1239',
          unknown: '#6b7490',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      borderRadius: { xl: '1rem', '2xl': '1.375rem' },
      backdropBlur: { glass: '20px' },
      boxShadow: {
        /**
         * Glass depth: a hairline ring, a close contact shadow and a wide soft
         * one. The inset highlight along the top edge is what reads as a lit
         * bevel and stops the panel looking like flat translucent plastic.
         */
        glass:
          '0 1px 1px rgba(21, 24, 48, 0.04), 0 8px 24px -12px rgba(21, 24, 48, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.85)',
        'glass-lg':
          '0 2px 4px rgba(21, 24, 48, 0.05), 0 24px 48px -20px rgba(21, 24, 48, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        raised: '0 1px 2px rgba(21, 24, 48, 0.06), 0 4px 12px -6px rgba(21, 24, 48, 0.12)',
        glow: '0 0 0 1px rgba(91, 91, 214, 0.28), 0 8px 24px -8px rgba(91, 91, 214, 0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-in': {
          from: { opacity: 0, transform: 'translateY(-6px) scale(0.99)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        /** Very slow drift of the background colour fields. */
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -3%, 0) scale(1.08)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in': 'slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        drift: 'drift 28s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
