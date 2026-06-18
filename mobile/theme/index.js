/**
 * Brutalist navy + amber theme tokens.
 * Single source of truth for colors, spacing, type, and shadow.
 */

export const colors = {
  bg:          '#0D1B2A',  // deep navy — primary background
  bgElevated:  '#13243A',  // slightly lifted surface
  card:        '#F5F0E8',  // off-white card surface
  cardDark:    '#162A40',  // dark card (chat bubble AI, code editor)
  accent:      '#F5A623',  // amber — borders, indices, highlights
  accentSoft:  '#F5A62333',
  text:        '#F5F0E8',  // body text on dark bg
  textInverse: '#0D1B2A',  // text on cream cards
  textMuted:   '#9AA8BA',
  border:      '#F5A623',
  danger:      '#E5484D',
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
};

export const radius = {
  none: 0,
  sm: 4,    // brutalist — minimal rounding
  md: 8,
  pill: 999,
};

export const type = {
  // Map to Syne / Space Mono / DM Sans once fonts are loaded with expo-font.
  // Until then, system fallbacks render the structure cleanly.
  display:  { fontFamily: 'Syne_700Bold',     fontSize: 32, letterSpacing: -0.5 },
  heading:  { fontFamily: 'Syne_600SemiBold', fontSize: 22, letterSpacing: -0.3 },
  mono:     { fontFamily: 'SpaceMono_400Regular', fontSize: 14 },
  body:     { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22 },
  bodyBold: { fontFamily: 'DMSans_700Bold',    fontSize: 15, lineHeight: 22 },
  label:    { fontFamily: 'DMSans_500Medium',  fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
};

// Hard 4px amber shadow — the signature brutalist offset.
export const brutalShadow = {
  shadowColor: colors.accent,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default { colors, spacing, radius, type, brutalShadow };
