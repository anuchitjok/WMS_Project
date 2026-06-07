/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#081120',
        surface: '#0F172A',
        card: '#111827',
        border: 'rgba(255,255,255,0.08)',
        cyan: '#00E5FF',
        teal: '#00C2A8',
        blue: '#3B82F6',
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#38BDF8',
      },
    },
  },
  plugins: [],
};
