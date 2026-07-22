import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        prova: {
          primary: '#5d4cf5',
          'primary-light': '#6d5dfc',
          'primary-disabled': '#dedaff',
          dark: '#17213b',
          text: {
            DEFAULT: '#17213b',
            secondary: '#34405f',
            tertiary: '#68738f',
            muted: '#7783a5',
            light: '#aeb9db',
            lighter: '#91a0cb',
          },
          sidebar: '#101936',
          'sidebar-dark': '#2b3865',
          'sidebar-hover': '#202c53',
          'sidebar-text': '#dfe6ff',
          'sidebar-text-muted': '#91a0cb',
          bg: {
            DEFAULT: '#f5f7fb',
            surface: '#ffffff',
            elevated: '#ece9ff',
          },
          border: {
            DEFAULT: '#e3e8f3',
            light: '#dbe0ec',
            lighter: '#cfd6e6',
          },
          success: '#35d39d',
          warning: '#c9364b',
          error: {
            DEFAULT: '#c9364b',
            secondary: '#a92338',
            tertiary: '#ad293d',
          },
          info: '#34405f',
        },
      },
      spacing: {
        px: '1px',
        0: '0',
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        7: '28px',
        8: '32px',
        9: '36px',
        10: '40px',
        11: '44px',
        12: '48px',
      },
      borderRadius: {
        'none': '0',
        'xs': '4px',
        'sm': '8px',
        'md': '10px',
        'lg': '12px',
        'xl': '14px',
        '2xl': '15px',
        'full': '9999px',
      },
      fontSize: {
        'xs': ['0.72rem', { lineHeight: '1rem' }],
        'sm': ['0.8rem', { lineHeight: '1.1rem' }],
        'base': ['0.86rem', { lineHeight: '1.25rem' }],
        'lg': ['1rem', { lineHeight: '1.5rem' }],
        'xl': ['1.2rem', { lineHeight: '1.6rem' }],
        '2xl': ['1.8rem', { lineHeight: '2.2rem' }],
        '3xl': ['2.6rem', { lineHeight: '3rem' }],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },
      boxShadow: {
        'sm': '0 2px 8px rgba(31, 42, 82, 0.08)',
        'md': '0 8px 28px rgba(31, 42, 82, 0.05)',
        'lg': '0 24px 80px rgba(8, 14, 34, 0.3)',
        'xl': '0 16px 42px rgba(8, 14, 34, 0.22)',
      },
      letterSpacing: {
        'tight': '-0.04em',
        'normal': '0',
        'wide': '0.1em',
        'wider': '0.15em',
      },
      gridTemplateColumns: {
        'app': '248px minmax(0, 1fr)',
        'app-mobile': '76px minmax(0, 1fr)',
        '3-col': 'repeat(3, minmax(0, 1fr))',
      },
      zIndex: {
        'modal-backdrop': '50',
        'modal': '51',
        'toast': '60',
      },
    },
  },
  plugins: [],
}

export default config
