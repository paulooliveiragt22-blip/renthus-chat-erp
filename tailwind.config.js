/** @type {import('tailwindcss').Config} */
// NOTE: Tailwind v4 does not use this file for content scanning.
// Content paths are declared via @source in app/globals.css.
// Colors declared here são apenas para autocomplete do IDE.
// As cores reais são definidas via @theme inline em app/globals.css.
module.exports = {
  content: [],
  theme: {
    extend: {
      colors: {
        // Paleta Renthus — espelha os tokens em globals.css
        primary: {
          DEFAULT: "#16364D",
          light:   "#1f4a68",
          dark:    "#0f2838",
        },
        accent: {
          DEFAULT: "#57ff8f",
          dark:    "#2ee66f",
        },
      },
    },
  },
  plugins: [],
};
