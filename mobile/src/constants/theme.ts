export const colors = {
  bg: '#07070C',
  surface: '#12121B',
  surfaceRaised: '#1B1B27',
  border: '#272736',
  text: '#F4F4F8',
  textMuted: '#9A9AB0',
  textFaint: '#5E5E73',
  accent: '#00C2FF',
  accentText: '#04121A',
  danger: '#FF5A5F',
  success: '#3DDC97',
  warning: '#FFD23F',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const type = {
  hero: { fontSize: 44, fontWeight: '800' as const, letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  label: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
};
