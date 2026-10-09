/**
 * LottoPilot theme: light gray surfaces + gold accents
 */

export const COLORS = {
  // Light gray page, slightly lighter cards
  bg: '#e6e6e6',
  bgCard: '#f4f4f4',
  bgElevated: '#d8d8d8',
  /** Label color on gold / bright buttons (was the old dark page color). */
  onGold: '#1a1a1a',
  /** Digits on indigo / green number balls. */
  onFill: '#f8fafc',
  primary: '#1a1a1a',
  primaryLight: '#3f3f46',

  // Neutral gray
  gray900: '#1f2937',
  gray700: '#374151',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray300: '#d1d5db',

  // Gold accent
  gold: '#d4af37',
  goldMuted: '#b8962e',

  // Semantic
  success: '#10b981',
  successMuted: '#059669',
  error: '#ef4444',
  warning: '#f59e0b',

  // Text on light surfaces
  text: '#1a1a1a',
  textSecondary: '#3f3f46',
  textMuted: '#5c5c5c',
} as const;

export const SPACING = {
  screenPadding: 20,
  screenPaddingBottom: 48,
  tabBarHeight: 56,
  safeTop: 8,
  safeBottom: 8,
} as const;
