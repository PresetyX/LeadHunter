import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { DEFAULT: "#0f1412", soft: "#1a211e", line: "#2a332f" },
        lime: { DEFAULT: "#A9EA2E", dim: "#82C91E" },
      },
    },
  },
  plugins: [],
};

export default config;
