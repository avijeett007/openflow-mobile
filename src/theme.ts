/**
 * OpenFlow Mobile design tokens — dark theme, violet brand accent.
 * Kept RN-free (plain constants) so it is importable from tests too.
 */

export const colors = {
  /** OpenFlow brand violet — the "Open" half of the wordmark + primary accent. */
  violet: '#7C5CFF',
  violetDim: '#5B44C0',
  /** App background (near-black). */
  bg: '#0B0B0F',
  /** Slightly raised surface (cards, inputs). */
  surface: '#16161D',
  surfaceAlt: '#1F1F29',
  border: '#2A2A36',
  text: '#F5F5F7',
  textDim: '#9A9AA5',
  textFaint: '#6A6A75',
  danger: '#FF5C5C',
  success: '#3ECF8E',
  warning: '#FFB020',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const font = {
  wordmark: 34,
  title: 26,
  heading: 20,
  body: 16,
  small: 14,
  tiny: 12,
} as const;
