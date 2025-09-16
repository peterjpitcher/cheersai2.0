import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand + semantic tokens (mapped to CSS variables)
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        background: "hsl(var(--background))",
        surface: "hsl(var(--surface))",
        'text-primary': "hsl(var(--text-primary))",
        'text-secondary': "hsl(var(--text-secondary))",
        border: "hsl(var(--border))",
        success: "hsl(var(--success))",
        error: "hsl(var(--error))",
        warning: "hsl(var(--warning))",
        
        // ShadCN defaults
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      fontFamily: {
        'heading': ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        'body': ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        // Dashboard usage aliases (no new sizes, just semantic names)
        'title-sm': ['1.125rem', { lineHeight: '1.75rem' }], // text-lg
        'number-lg': ['1.25rem', { lineHeight: '1.75rem' }], // text-xl
        'number-xl': ['1.5rem', { lineHeight: '2rem' }],     // text-2xl
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        // Page gutter aliases for clarity
        'page-x-sm': '1rem',   // 16px (px-4)
        'page-x-md': '1.5rem', // 24px (sm:px-6)
        'page-x-lg': '2rem',   // 32px (lg:px-8)
        'page-pt': '1.5rem',   // 24px (pt-6)
        'page-pb': '2rem',     // 32px (pb-8)
        '18': '4.5rem',
        '88': '22rem',
        '120': '30rem',
      },
      borderRadius: {
        // Aliases matching Dashboard usage
        'card': 'var(--radius)', // equals rounded-lg (8px by default)
        'chip': '12px',          // used for icon chips in cards/nav
        // Deprecated: prefer 'card' or 'chip' where appropriate
        'soft': '8px',           // deprecated: use 'card'
        'medium': '12px',        // deprecated: use 'chip'
        'large': '16px',
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Aliases for card elevation used on Dashboard (match Tailwind defaults to avoid visual change)
        'card': '0 1px 2px 0 rgb(0 0 0 / 0.05)', // shadow-sm
        'cardHover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)', // shadow-md
        'soft': '0 2px 8px rgba(0,0,0,0.06)',
        'medium': '0 8px 24px rgba(0,0,0,0.08)',
        'large': '0 16px 48px rgba(0,0,0,0.12)',
        'warm': '0 4px 12px rgba(234, 88, 12, 0.15)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
      transitionDuration: {
        'fast': '150ms',
        'base': '250ms',
        'slow': '350ms',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
