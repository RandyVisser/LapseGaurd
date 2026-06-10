/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    'border-2',
    'border-green-400',
    'border-amber-400',
    'border-red-400',
    'border-slate-200',
  ],
}
