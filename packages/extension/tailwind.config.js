/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './popup.html'],
  // Class `dark:` (dùng trong component Aceternity) theo nút sáng/tối của ví: <html data-theme="dark">.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Màu lấy từ biến CSS (style.css) để đổi giao diện sáng/tối mà không đổi class.
      colors: {
        night: Object.fromEntries([950, 900, 850, 800, 700, 600, 500].map((k) => [k, `rgb(var(--night-${k}) / <alpha-value>)`])),
        moon: { DEFAULT: 'rgb(var(--moon) / <alpha-value>)', soft: 'rgb(var(--moon-soft) / <alpha-value>)', dim: 'rgb(var(--moon-dim) / <alpha-value>)' },
        /** Chữ chính (trắng ở giao diện tối, gần đen ở giao diện sáng). Chữ trên nền màu đậm vẫn dùng `white`. */
        ink: 'rgb(var(--ink) / <alpha-value>)',
        brand: { hi: 'rgb(var(--brand-hi) / <alpha-value>)', mid: 'rgb(var(--brand-mid) / <alpha-value>)', deep: 'rgb(var(--brand-deep) / <alpha-value>)' },
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)', hover: 'rgb(var(--accent-hover) / <alpha-value>)', deep: 'rgb(var(--brand-deep) / <alpha-value>)' },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 10px 40px -10px rgb(var(--accent) / 0.55)',
        card: 'var(--shadow-card)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        twinkle: { '0%,100%': { opacity: '0.25' }, '50%': { opacity: '1' } },
        // Aceternity UI: Meteors, Aurora Background, Spotlight
        meteor: {
          '0%': { transform: 'rotate(215deg) translateX(0)', opacity: '1' },
          '70%': { opacity: '1' },
          '100%': { transform: 'rotate(215deg) translateX(-500px)', opacity: '0' },
        },
        aurora: { from: { backgroundPosition: '50% 50%, 50% 50%' }, to: { backgroundPosition: '350% 50%, 350% 50%' } },
        spotlight: {
          '0%': { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(-50%,-40%) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out both',
        twinkle: 'twinkle 3s ease-in-out infinite',
        'meteor-effect': 'meteor 5s linear infinite',
        aurora: 'aurora 60s linear infinite',
        spotlight: 'spotlight 2s ease .75s 1 forwards',
      },
    },
  },
  plugins: [],
};
