/**
 * Per-project XLSX upload with staggered "values flowing into fields" animation.
 * Uses react-native-reanimated for the reveal effect.
 *
 * Flow:
 *   1. User picks an XLSX file (expo-document-picker)
 *   2. File is multipart-POSTed to /projects/{projectId}/upload-excel
 *   3. On success, each extracted field fades + slides in one after another
 *      giving the impression of data flowing from the spreadsheet into the form.
 */

import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Animated } from 'react-native';
import { TRACKER as API_BASE, authHeaders } from '../config/api';
import { colors, spacing, type, radius, brutalShadow } from '../theme';
import PillButton from '../components/PillButton';
import BrutalCard from '../components/BrutalCard';

const PLACEHOLDER = 'Not filled';
const STAGGER_MS  = 90;   // delay between each field reveal
const DURATION_MS = 340;

function AnimatedField({ label, value, index }) {
  const opacity    = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(12)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: DURATION_MS, delay: index * STAGGER_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: DURATION_MS, delay: index * STAGGER_MS, useNativeDriver: true }),
    ]).start();
  }, [value]);

  const anim = { opacity, transform: [{ translateY }] };

  const empty = !value;
  return (
    <Animated.View style={[styles.fieldRow, anim]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, empty && styles.fieldEmpty]}>
        {empty ? PLACEHOLDER : value}
      </Text>
    </Animated.View>
  );
}

export default function UploadScreen({ route, navigation }) {
  const { projectId } = route.params;
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null);   // API response payload
  const [error, setError]     = useState(null);

  // Reset animation values when result changes
  const resultKey = useRef(0);

  async function pickAndUpload() {
    const pick = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      copyToCacheDirectory: true,
    });
    if (pick.canceled) return;
    const file = pick.assets[0];

    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' });

      const res = await fetch(`${API_BASE}/projects/${projectId}/upload-excel`, {
        method: 'POST',
        headers: await authHeaders(false),  // let fetch set multipart boundary
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Upload failed (${res.status})`);
      resultKey.current += 1;
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const p = result?.project;
  const students = p?.students || [];

  const fields = p ? [
    { label: 'TITLE',  value: p.title  },
    { label: 'GITHUB', value: p.github },
    { label: 'GUIDE',  value: p.guide  },
    ...students.map((s, i) => ({ label: `STUDENT ${i + 1}`, value: s.usn && s.name ? `${s.usn} · ${s.name}` : null })),
  ] : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>UPLOAD</Text>
      <Text style={styles.title}>TEAM SHEET</Text>
      <Text style={styles.subtitle}>
        Pick the XLSX file for this project.{'\n'}
        Each row fills the team's details.
      </Text>

      <View style={styles.btnRow}>
        <PillButton label={busy ? 'Uploading…' : 'Pick XLSX'} onPress={pickAndUpload} loading={busy} />
        <PillButton
          label="Download Template"
          variant="outline"
          onPress={async () => {
            // Importing expo-sharing inline keeps the dep tree lighter when unused
            const Sharing = await import('expo-sharing');
            const FS      = await import('expo-file-system');
            const dest = FS.documentDirectory + 'project_template.xlsx';
            const dl = await FS.downloadAsync(`${API_BASE}/download-template`, dest, {
              headers: await authHeaders(),
            });
            if (dl.status === 200) await Sharing.shareAsync(dest);
          }}
        />
      </View>

      {!!error && (
        <BrutalCard style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </BrutalCard>
      )}

      {result && (
        <View key={resultKey.current}>
          <View style={styles.statsRow}>
            <StatChip label="Members added" value={result.students_inserted} />
            {result.partial_slots_skipped > 0 && (
              <StatChip label="Incomplete slots skipped" value={result.partial_slots_skipped} />
            )}
          </View>

          <Text style={styles.sectionLabel}>EXTRACTED DATA</Text>
          <BrutalCard dark style={styles.fieldsCard}>
            {fields.map((f, i) => (
              <AnimatedField key={`${f.label}-${resultKey.current}`} label={f.label} value={f.value} index={i} />
            ))}
          </BrutalCard>

          <PillButton
            label="View Project"
            onPress={() => navigation.navigate('ProjectDetail', { projectId })}
            style={{ marginTop: spacing.xl }}
          />
        </View>
      )}
    </ScrollView>
  );
}

function StatChip({ label, value }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: colors.bg },
  content:  { padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
  eyebrow:  { ...type.label, color: colors.accent },
  title:    { ...type.display, color: colors.text, marginTop: spacing.xs },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xl },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xl },

  errorCard: { backgroundColor: '#2A1215', marginBottom: spacing.lg },
  errorText: { ...type.body, color: colors.danger },

  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  chip: {
    flex: 1, borderWidth: 2, borderColor: colors.accent, borderRadius: radius.sm,
    padding: spacing.md, alignItems: 'center', ...brutalShadow,
    backgroundColor: colors.bgElevated,
  },
  chipValue: { ...type.display, color: colors.accent },
  chipLabel: { ...type.label,   color: colors.textMuted, marginTop: 2, textAlign: 'center' },

  sectionLabel: { ...type.label, color: colors.accent, marginBottom: spacing.sm },
  fieldsCard:   { gap: spacing.sm },

  fieldRow: {
    borderBottomWidth: 1, borderColor: colors.accentSoft,
    paddingVertical: spacing.sm,
  },
  fieldLabel: { ...type.label, color: colors.accent },
  fieldValue: { ...type.body,  color: colors.text, marginTop: 2 },
  fieldEmpty: { fontStyle: 'italic', color: colors.textMuted },
});
