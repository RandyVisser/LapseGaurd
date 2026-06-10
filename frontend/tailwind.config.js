/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    'border-l-4',
    'border-l-green-400',
    'border-l-amber-400',
    'border-l-red-400',
    'border-l-slate-200',
  ],
}
