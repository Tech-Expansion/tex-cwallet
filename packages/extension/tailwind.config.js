/** @type {import('tailwindcss').Config} */
// Design system: CKBolt (ink on paper, monochrome, color only for state). Tokens live in src/popup/style.css.
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './popup.html'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Token names kept from the previous system so every screen re-skins through style.css:
      // night-* = surfaces (950 page … 500 strong rule), moon-* = text, ink = foreground, accent = primary action.
      colors: {
        night: Object.fromEntries([950, 900, 850, 800, 700, 600, 500].map((k) => [k, `rgb(var(--night-${k}) / <alpha-value>)`])),
        moon: { DEFAULT: 'rgb(var(--moon) / <alpha-value>)', soft: 'rgb(var(--moon-soft) / <alpha-value>)', dim: 'rgb(var(--moon-dim) / <alpha-value>)' },
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)', hover: 'rgb(var(--accent-hover) / <alpha-value>)' },
        // State colors: never decorative. ok = settled/live, warn = pending/held/action needed, bad = failed/refunded.
        ok: { DEFAULT: 'rgb(var(--ok) / <alpha-value>)', bright: 'rgb(var(--ok-bright) / <alpha-value>)', soft: 'rgb(var(--ok-soft) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', bright: 'rgb(var(--warn-bright) / <alpha-value>)', soft: 'rgb(var(--warn-soft) / <alpha-value>)' },
        bad: { DEFAULT: 'rgb(var(--bad) / <alpha-value>)', soft: 'rgb(var(--bad-soft) / <alpha-value>)' },
      },
      borderColor: { hair: 'rgb(var(--ink) / 0.10)', 'hair-strong': 'rgb(var(--ink) / 0.20)' },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontWeight: { semibold: '500', bold: '500' },
      letterSpacing: { display: '-0.025em', figure: '-0.035em' },
      boxShadow: { card: 'none' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-up': 'fade-up 0.2s ease-out both' },
    },
  },
  plugins: [],
};
