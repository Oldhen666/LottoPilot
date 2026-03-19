/**
 * LottoPilot theme: deep blue / indigo + neutral gray + gold accents
 */

export const COLORS = {
  // Deep blue / indigo
  bg: '#0c1629',
  bgCard: '#152238',
  bgElevated: '#1e3254',
  primary: '#4f46e5',
  primaryLight: '#6366f1',

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

  // Text
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
} as const;

export const SPACING = {
  screenPadding: 20,
  screenPaddingBottom: 48,
  tabBarHeight: 56,
  safeTop: 8,
  safeBottom: 8,
} as const;
