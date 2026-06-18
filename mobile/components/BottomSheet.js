import React from 'react';
import { Modal, View, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

/**
 * Lightweight bottom sheet — no extra deps.
 * Tapping the backdrop closes; the sheet itself stops propagation.
 */
export default function BottomSheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderTopWidth: 2,
    borderColor: colors.accent,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 48, height: 4,
    backgroundColor: colors.accent,
    marginBottom: spacing.lg,
  },
  title: {
    ...type.heading,
    color: colors.text,
    marginBottom: spacing.lg,
  },
});
