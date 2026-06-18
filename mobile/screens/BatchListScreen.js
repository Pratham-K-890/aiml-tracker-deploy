import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  Pressable, RefreshControl, TextInput, Alert,
} from 'react-native';
import { TRACKER as API_BASE, authHeaders } from '../config/api';
import { colors, spacing, type, radius, brutalShadow } from '../theme';
import BrutalCard from '../components/BrutalCard';
import PillButton from '../components/PillButton';
import BottomSheet from '../components/BottomSheet';

export default function BatchListScreen({ navigation }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchName, setBatchName]   = useState('');
  const [year, setYear]             = useState('');
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/batches`, { headers: await authHeaders() });
      const data = await res.json();
      setBatches(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert('Error', `Could not load batches: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  async function createBatch() {
    if (!batchName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/batches`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ batch_name: batchName.trim(), year: year ? parseInt(year) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      setCreateOpen(false); setBatchName(''); setYear('');
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  }

  function renderItem({ item }) {
    return (
      <Pressable onPress={() => navigation.navigate('Semesters', { batchId: item.batch_id, batchName: item.batch_name })}>
        {({ pressed }) => (
          <BrutalCard style={[styles.card, pressed && styles.cardPressed]}>
            <Text style={styles.cardTitle}>{item.batch_name}</Text>
            {item.year ? <Text style={styles.cardMeta}>{item.year}</Text> : null}
            <Text style={styles.chevron}>→</Text>
          </BrutalCard>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PROJECT TRACKER</Text>
        <Text style={styles.title}>BATCHES</Text>
      </View>

      <FlatList
        data={batches}
        keyExtractor={b => b.batch_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={!loading && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>□</Text>
            <Text style={styles.emptyText}>No batches yet.{'\n'}Create the first one.</Text>
          </View>
        )}
      />

      <View style={styles.fab}>
        <PillButton label="+ New Batch" onPress={() => setCreateOpen(true)} />
      </View>

      <BottomSheet visible={createOpen} onClose={() => setCreateOpen(false)} title="New Batch">
        <Text style={styles.fieldLabel}>BATCH NAME</Text>
        <TextInput
          style={styles.input} value={batchName} onChangeText={setBatchName}
          placeholder="e.g. 2024-2028" placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.fieldLabel}>START YEAR (optional)</Text>
        <TextInput
          style={styles.input} value={year} onChangeText={setYear}
          placeholder="e.g. 2024" placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
        />
        <PillButton label="Create" onPress={createBatch} loading={saving} style={{ marginTop: spacing.lg }} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  eyebrow: { ...type.label, color: colors.accent },
  title:   { ...type.display, color: colors.text, marginTop: spacing.xs },
  list:    { padding: spacing.xl, paddingBottom: 120 },

  card: { marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' },
  cardPressed: { transform: [{ translateY: 2 }] },
  cardTitle: { ...type.heading, color: colors.textInverse, flex: 1 },
  cardMeta:  { ...type.label,   color: colors.textInverse, opacity: 0.6, marginRight: spacing.md },
  chevron:   { ...type.heading, color: colors.accent },

  empty: { alignItems: 'center', marginTop: 80, gap: spacing.md },
  emptyIcon: { fontSize: 48, color: colors.accent },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },

  fab: { position: 'absolute', bottom: spacing.xl, alignSelf: 'center' },

  fieldLabel: { ...type.label, color: colors.accent, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    borderWidth: 2, borderColor: colors.accent, borderRadius: radius.sm,
    color: colors.text, padding: spacing.md, ...type.body,
  },
});
