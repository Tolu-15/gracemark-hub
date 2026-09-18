import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-dm-serif)", "Georgia", "serif"],
      },
      colors: {
        gold: {
          DEFAULT: "#c9a84c",
          lt: "#e8c97a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
