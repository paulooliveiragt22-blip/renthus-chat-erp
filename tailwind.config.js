/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        prodifyPurple: "#3B246B",
        prodifyOrange: "#FF6600",
        prodifyGreen: "#0DAA00",
      },
    },
  },
  plugins: [],
};
