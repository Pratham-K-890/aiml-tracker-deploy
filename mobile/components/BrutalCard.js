import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing, brutalShadow } from '../theme';

/**
 * Off-white brutalist card with hard 4px amber drop shadow.
 * Pass `dark` for the navy variant used in chat / code-editor surfaces.
 */
export default function BrutalCard({ children, dark, style }) {
  return (
    <View style={[
      styles.card,
      dark ? styles.dark : styles.light,
      brutalShadow,
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    padding: spacing.lg,
  },
  light: { backgroundColor: colors.card },
  dark:  { backgroundColor: colors.cardDark },
});
