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
          DEFAULT: "#4c1d95",
          light:   "#6d28d9",
          dark:    "#3b1570",
        },
        accent: {
          DEFAULT: "#f97316",
          dark:    "#ea580c",
        },
      },
    },
  },
  plugins: [],
};
