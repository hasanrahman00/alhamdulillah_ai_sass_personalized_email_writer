
/* eslint-env node */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        'warm-cream': '#F8F6F3',
        'soft-blue': '#6B9BD1',
        'soft-blue-dark': '#5A8AC0',
        'gentle-orange': '#F4A261',
        'gentle-orange-light': '#FCD5B5',
        'accent-orange': '#FFA239',
        'success-green': '#81C784',
        'warm-gray': '#4A4A4A',
        'warm-gray-light': '#8A8A8A',
        'deep-navy': '#0C2B4E',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI (Custom)"', 'Roboto', '"Helvetica Neue"', '"Open Sans (Custom)"', 'system-ui', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"'],
      },
      borderRadius: {
        '3xl': '1.5rem',
      }
    },
  },
  plugins: [],
}
