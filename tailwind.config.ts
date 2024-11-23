import type { Config } from 'tailwindcss'

/** @type {import('tailwindcss').Config} */
const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#1A1C1E',
        surface: '#1E2024',
        border: '#2A2D31',
      }
    },
  },
  plugins: [],
}

export default config

