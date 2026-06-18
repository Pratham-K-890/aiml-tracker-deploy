import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

export default function PillButton({ label, onPress, loading, variant = 'solid', disabled, style }) {
  const isSolid = variant === 'solid';
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        isSolid ? styles.solid : styles.outline,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSolid ? colors.bg : colors.accent} />
      ) : (
        <Text style={[styles.label, { color: isSolid ? colors.bg : colors.accent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solid:   { backgroundColor: colors.accent },
  outline: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  pressed:  { transform: [{ translateY: 2 }] },
  label: { ...type.bodyBold, letterSpacing: 0.4 },
});
