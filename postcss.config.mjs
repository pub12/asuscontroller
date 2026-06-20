// Tailwind v4 runs as a PostCSS plugin. Without this, `@import "tailwindcss"`
// in globals.css is never processed and zero utility classes are emitted.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
