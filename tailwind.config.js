/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Surface */
        surface: {
          DEFAULT:             '#f8fafa',
          dim:                 '#d8dada',
          bright:              '#f8fafa',
          'container-lowest':  '#ffffff',
          'container-low':     '#f2f4f4',
          container:           '#eceeee',
          'container-high':    '#e6e8e8',
          'container-highest': '#e1e3e3',
          variant:             '#e1e3e3',
          tint:                '#20686f',
        },
        'on-surface':         '#191c1d',
        'on-surface-variant': '#3f484a',
        'inverse-surface':    '#2e3131',
        'inverse-on-surface': '#eff1f1',
        outline: {
          DEFAULT: '#6f797a',
          variant: '#bfc8c9',
        },

        /* Primary */
        primary: {
          DEFAULT:    '#004349',
          container:  '#0d5c63',
          fixed:      '#abeef6',
          'fixed-dim': '#8fd1d9',
        },
        'on-primary':                  '#ffffff',
        'on-primary-container':        '#90d2da',
        'inverse-primary':             '#8fd1d9',
        'on-primary-fixed':            '#002023',
        'on-primary-fixed-variant':    '#004f55',

        /* Secondary */
        secondary: {
          DEFAULT:    '#805600',
          container:  '#fdba49',
          fixed:      '#ffddaf',
          'fixed-dim': '#fdba49',
        },
        'on-secondary':                '#ffffff',
        'on-secondary-container':      '#704b00',
        'on-secondary-fixed':          '#281800',
        'on-secondary-fixed-variant':  '#614000',

        /* Tertiary */
        tertiary: {
          DEFAULT:    '#5c310d',
          container:  '#784722',
          fixed:      '#ffdcc6',
          'fixed-dim': '#fcb889',
        },
        'on-tertiary':                 '#ffffff',
        'on-tertiary-container':       '#fcb88a',
        'on-tertiary-fixed':           '#301400',
        'on-tertiary-fixed-variant':   '#693b17',

        /* Error */
        error: {
          DEFAULT:   '#ba1a1a',
          container: '#ffdad6',
        },
        'on-error':           '#ffffff',
        'on-error-container': '#93000a',

        /* Background */
        background:     '#f8fafa',
        'on-background': '#191c1d',
      },

      fontFamily: {
        sans:       ['Inter', 'system-ui', 'sans-serif'],
        serif:      ['Newsreader', 'Georgia', 'serif'],
        inter:      ['Inter', 'system-ui', 'sans-serif'],
        newsreader: ['Newsreader', 'Georgia', 'serif'],
      },

      fontSize: {
        'display-lg':  ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-md':  ['36px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-lg': ['28px', { lineHeight: '1.3', fontWeight: '500' }],
        'headline-md': ['22px', { lineHeight: '1.4', fontWeight: '500' }],
        'body-lg':     ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md':     ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'label-md':    ['14px', { lineHeight: '1.2', letterSpacing: '0.02em', fontWeight: '600' }],
        'label-sm':    ['12px', { lineHeight: '1.2', fontWeight: '500' }],
      },

      spacing: {
        unit:            '4px',
        xs:              '4px',
        sm:              '8px',
        md:              '16px',
        lg:              '24px',
        xl:              '48px',
        gutter:          '24px',
        'margin-mobile': '16px',
        'margin-desktop': '64px',
      },

      borderRadius: {
        sm:      '0.25rem',
        DEFAULT: '0.5rem',
        md:      '0.75rem',
        lg:      '1rem',
        xl:      '1.5rem',
        full:    '9999px',
      },

      boxShadow: {
        sm: '0 2px 4px rgba(13, 92, 99, 0.08)',
        md: '0 8px 16px rgba(13, 92, 99, 0.08)',
        lg: '0 16px 32px rgba(13, 92, 99, 0.08)',
      },

      maxWidth: {
        content: '1280px',
      },
    },
  },
  plugins: [],
};
