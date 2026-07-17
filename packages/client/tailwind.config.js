/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AIS brand red (sampled from the logo wordmark ~#CE202B).
        brand: {
          50: '#fef2f3',
          100: '#fde3e4',
          200: '#fbcccf',
          300: '#f7a3a8',
          400: '#f06f77',
          500: '#e33e49',
          600: '#ce202b',
          700: '#ac1822',
          800: '#8e1721',
          900: '#761821',
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
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
      },
    },
  },
  plugins: [],
};
