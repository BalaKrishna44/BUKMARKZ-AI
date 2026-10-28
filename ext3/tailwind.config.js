/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/popup/**/*.{html,tsx,ts}'],
  theme: { extend: { colors: { brand: { DEFAULT: '#fca311', ink: '#14213d' } } } },
};
