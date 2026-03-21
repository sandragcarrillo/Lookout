/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        score:   ['var(--font-oswald)',   'Impact', "'Arial Narrow'", 'sans-serif'],
        sans:    ['var(--font-plex)',     'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)',     "'Courier New'", 'monospace'],
      },
      colors: {
        bg: {
          0: '#060508',
          1: '#0b090d',
          2: '#100e14',
          3: '#181520',
        },
        ink: {
          DEFAULT: '#ede0cc',
          2: '#8a7f8e',
          3: '#4a4250',
          4: '#2a2530',
        },
        border: {
          DEFAULT: '#1e1a26',
          bright:  '#2d283a',
        },
        accent: '#d4a855',
        score: {
          bad:     '#c0392b',
          caution: '#d4a030',
          good:    '#27a864',
          diamond: '#00b8d4',
        },
      },
      animation: {
        'fade-up':    'fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) forwards',
        'fade-in':    'fadeIn 0.4s ease-out forwards',
        'bar-fill':   'barExpand 1s cubic-bezier(0.16,1,0.3,1) forwards',
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
        'scan-beam':  'scanBeam 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp:    { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn:    { from: { opacity: '0', transform: 'scale(0.92)' }, to: { opacity: '1', transform: 'scale(1)' } },
        barExpand: { from: { width: '0%' }, to: { width: 'var(--bar-target)' } },
        glowPulse: { '0%,100%': { opacity: '0.5' }, '50%': { opacity: '0.9' } },
        scanBeam:  {
          '0%':   { transform: 'translateX(-100%)', opacity: '0' },
          '15%':  { opacity: '1' },
          '85%':  { opacity: '1' },
          '100%': { transform: 'translateX(400%)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
