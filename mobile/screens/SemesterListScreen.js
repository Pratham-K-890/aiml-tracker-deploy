import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  Pressable, RefreshControl,
} from 'react-native';
import { TRACKER as API_BASE, authHeaders } from '../config/api';
import { colors, spacing, type } from '../theme';
import BrutalCard from '../components/BrutalCard';
import PillButton from '../components/PillButton';
import BottomSheet from '../components/BottomSheet';

// Semesters available to create for a batch (only odd present in most colleges;
// we allow all 1-8 and let the coordinator pick)
const ALL_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function SemesterListScreen({ route, navigation }) {
  const { batchId, batchName } = route.params;
  const [semesters, setSemesters] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [selected, setSelected]   = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/batches/${batchId}/semesters`, { headers: await authHeaders() });
    const data = await res.json();
    setSemesters(Array.isArray(data) ? data : []);
  }, [batchId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  const existingNums = new Set(semesters.map(s => s.sem_number));
  const available = ALL_SEMS.filter(n => !existingNums.has(n));

  async function addSemester() {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/batches/${batchId}/semesters`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ sem_number: selected }),
      });
      setAddOpen(false); setSelected(null);
      await load();
    } finally { setSaving(false); }
  }

  function renderItem({ item }) {
    return (
      <Pressable onPress={() => navigation.navigate('Courses', {
        semesterId: item.semester_id,
        semLabel: `Sem ${item.sem_number} · ${batchName}`,
      })}>
        {({ pressed }) => (
          <BrutalCard style={[styles.card, pressed && styles.cardPressed]}>
            <Text style={styles.semNum}>{String(item.sem_number).padStart(2, '0')}</Text>
            <Text style={styles.cardLabel}>SEMESTER</Text>
            <Text style={styles.chevron}>→</Text>
          </BrutalCard>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{batchName}</Text>
        <Text style={styles.title}>SEMESTERS</Text>
      </View>

      <FlatList
        data={semesters}
        keyExtractor={s => s.semester_id}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={!loading && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>□</Text>
            <Text style={styles.emptyText}>No semesters yet.</Text>
          </View>
        )}
      />

      {available.length > 0 && (
        <View style={styles.fab}>
          <PillButton label="+ Add Semester" onPress={() => setAddOpen(true)} />
        </View>
      )}

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add Semester">
        <Text style={styles.fieldLabel}>PICK SEMESTER</Text>
        <View style={styles.semGrid}>
          {available.map(n => (
            <Pressable key={n} onPress={() => setSelected(n)} style={[styles.semChip, selected === n && styles.semChipActive]}>
              <Text style={[styles.semChipText, selected === n && styles.semChipTextActive]}>
                Sem {n}
              </Text>
            </Pressable>
          ))}
        </View>
        <PillButton label="Add" onPress={addSemester} loading={saving} disabled={!selected} style={{ marginTop: spacing.lg }} />
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

  card: { flex: 1, marginBottom: spacing.md },
  cardPressed: { transform: [{ translateY: 2 }] },
  semNum:    { ...type.display, color: colors.textInverse },
  cardLabel: { ...type.label,   color: colors.textInverse, opacity: 0.6 },
  chevron:   { ...type.heading, color: colors.accent, marginTop: spacing.sm },

  empty: { alignItems: 'center', marginTop: 80, gap: spacing.md },
  emptyIcon: { fontSize: 48, color: colors.accent },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },

  fab: { position: 'absolute', bottom: spacing.xl, alignSelf: 'center' },

  fieldLabel: { ...type.label, color: colors.accent, marginBottom: spacing.md },
  semGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  semChip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderWidth: 2, borderColor: colors.accent, borderRadius: 4,
  },
  semChipActive: { backgroundColor: colors.accent },
  semChipText:      { ...type.bodyBold, color: colors.accent },
  semChipTextActive: { color: colors.bg },
});
