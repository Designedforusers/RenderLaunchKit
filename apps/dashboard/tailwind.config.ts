import type { Config } from 'tailwindcss';

/**
 * LaunchKit type scale.
 *
 * Two tiers — FAIRE Octave display (marquee surfaces only) and Ufficio text
 * (everything else). Six text sizes, four display sizes, one CAPS label.
 * Tracking/line-height are baked in via `fontSize` tuples so `text-heading-xl`
 * always renders with the right rhythm — no ad-hoc `leading-` / `tracking-`
 * overrides at call sites.
 *
 * Research anchors (see refero-design session): Resend uses CAPS 12px section
 * labels with ~1px tracking; Cursor keeps dashboard H1 at 18/600; GlossGenius
 * runs display serif at 72–120px / lh 0.95. This scale combines all three.
 */
const fontSize = {
  // Display tier — FAIRE Octave variable, marquee only
  'display-2xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '500' }],
  'display-xl':  ['3.5rem', { lineHeight: '1.02', letterSpacing: '-0.03em', fontWeight: '500' }],
  'display-lg':  ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '500' }],
  'display-md':  ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '500' }],

  // Heading tier — Ufficio, product chrome
  'heading-xl': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
  'heading-lg': ['1.25rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '600' }],
  'heading-md': ['1rem', { lineHeight: '1.35', letterSpacing: '0', fontWeight: '600' }],
  'heading-sm': ['0.875rem', { lineHeight: '1.4', letterSpacing: '0', fontWeight: '600' }],

  // Body tier — Ufficio, reading + UI
  'body-lg': ['1rem', { lineHeight: '1.6', letterSpacing: '0', fontWeight: '400' }],
  'body-md': ['0.875rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
  'body-sm': ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
  'body-xs': ['0.75rem', { lineHeight: '1.45', letterSpacing: '0', fontWeight: '400' }],

  // The Resend move — ALL-CAPS section label, tracked
  'label': ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '600' }],

  // Monospace for codes, IDs, SHAs, costs
  'mono-sm': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
  'mono-md': ['0.875rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
} as const;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize,
      colors: {
        surface: {
          50:  '#fdf5e6',
          100: '#f5ead0',
          200: '#e8d3b0',
          300: '#c5b8d8',
          400: '#8b7ba8',
          500: '#6b5d80',
          600: '#4d4259',
          700: '#332a3f',
          800: '#2a2040',
          850: '#201728',
          900: '#17112a',
          950: '#0c0815',
        },
        accent: {
          DEFAULT: '#ff5e4a',
          50:  '#fff2ef',
          100: '#ffd9d0',
          200: '#ffb09e',
          300: '#ff8670',
          400: '#ff6e56',
          500: '#ff5e4a',
          600: '#e0422f',
          700: '#a5301f',
          800: '#6f2015',
          900: '#3f120d',
        },
        // Semantic success/active — emerald green. Used for status indicators,
        // active-state dots, approval badges, progress bars, and anything that
        // communicates "this is working / succeeded." Accent (coral) stays for
        // brand CTAs, hover glows, and decorative elements.
        success: {
          DEFAULT: '#10b981',
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Ufficio', 'system-ui', 'sans-serif'],
        display: ['FAIRE Octave', 'Ufficio', 'system-ui', 'sans-serif'],
      },
      // Semantic text-color aliases. Name by role so the call site reads as
      // intent (`text-text-secondary`) rather than as a shade of grey. Mapped
      // onto the existing `surface` ramp so there's a single source of truth.
      textColor: {
        'text-primary': '#fdf5e6',   // surface-50  — headings, values, primary copy
        'text-secondary': '#c5b8d8', // surface-300 — body descriptions
        'text-tertiary': '#8b7ba8',  // surface-400 — labels, meta, captions
        'text-muted': '#6b5d80',     // surface-500 — disabled, placeholder, tracked CAPS labels
      },
      // Motion tokens used by the pipeline visualization. Framer Motion
      // and GSAP read these via Tailwind class names (arbitrary value
      // helpers) and via `theme('transitionTimingFunction.*')` in the
      // GSAP setup where we need the raw cubic-bezier string.
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-out-circ': 'cubic-bezier(0.85, 0, 0.15, 1)',
      },
      keyframes: {
        'shimmer-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'orbit': {
          '0%': { transform: 'rotate(0deg) translateX(14px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(14px) rotate(-360deg)' },
        },
        'breathe': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '40%': { opacity: '0.8' },
          '100%': { transform: 'translateY(200%)', opacity: '0' },
        },
        // Aurora halo for the active pipeline node. Two offset rings
        // fade in/out out of phase to create a soft pulsing glow that
        // reads as "alive" without being loud. Designed to pair with
        // `animate-aurora-inner`.
        'aurora-outer': {
          '0%, 100%': { opacity: '0.15', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(1.18)' },
        },
        'aurora-inner': {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1.02)' },
          '50%': { opacity: '0.75', transform: 'scale(1.1)' },
        },
        // Terminal-style cursor that ticks beside the live caption so
        // the stage reads as "the agent is still typing". Hard step,
        // not a fade — blink feels mechanical on purpose.
        'cursor-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },
      animation: {
        'shimmer-sweep': 'shimmer-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'orbit-slow': 'orbit 3.2s linear infinite',
        'orbit-medium': 'orbit 2.1s linear infinite',
        'breathe': 'breathe 2.4s ease-in-out infinite',
        'scan-line': 'scan-line 2s cubic-bezier(0.16, 1, 0.3, 1) infinite',
        'aurora-outer': 'aurora-outer 3.2s ease-in-out infinite',
        'aurora-inner': 'aurora-inner 2.4s ease-in-out infinite',
        'cursor-blink': 'cursor-blink 1s steps(1, end) infinite',
        // Slow linear rotation for the conic-gradient border chase
        // effect on the active pipeline card.
        'spin-border': 'spin 3.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
