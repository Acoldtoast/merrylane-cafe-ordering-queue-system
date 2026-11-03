/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "merrylane-cream": "#F8F4F0",
        "merrylane-beige": "#E8E0D5",
        "merrylane-warm-brown": "#8B5E3C",
        "merrylane-dark-brown": "#4A2E1F",
        "merrylane-charcoal": "#2B2B2B",
        "merrylane-light-brown": "#A67C52",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
