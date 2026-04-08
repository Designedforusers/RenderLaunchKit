import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          850: '#172033',
          900: '#0f172a',
          950: '#020617',
        },
        accent: {
          DEFAULT: '#10b981',
          50: '#ecfdf5',
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
        sans: ['Inter', 'system-ui', 'sans-serif'],
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
      },
      animation: {
        'shimmer-sweep': 'shimmer-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'orbit-slow': 'orbit 3.2s linear infinite',
        'orbit-medium': 'orbit 2.1s linear infinite',
        'breathe': 'breathe 2.4s ease-in-out infinite',
        'scan-line': 'scan-line 2s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
