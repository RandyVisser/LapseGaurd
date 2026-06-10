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
    'border-orange-400',
    'border-slate-200',
    'bg-amber-50',
    'bg-amber-100',
    'text-amber-700',
    'bg-orange-50',
    'bg-orange-100',
    'border-orange-200',
    'text-orange-800',
  ],
}
