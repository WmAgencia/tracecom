/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0e17',
          surface: '#111827',
          alt: '#1a2235',
        },
        border: '#1e2d40',
        text: {
          primary: '#e2e8f0',
          secondary: '#64748b',
        },
        accent: {
          cyan: '#22d3ee',
          green: '#34d399',
          red: '#f87171',
          yellow: '#fbbf24',
          gold: '#f59e0b',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
