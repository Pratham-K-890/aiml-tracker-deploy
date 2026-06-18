import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  Pressable, RefreshControl, TextInput,
} from 'react-native';
import { TRACKER as API_BASE, authHeaders } from '../config/api';
import { colors, spacing, type, radius } from '../theme';
import BrutalCard from '../components/BrutalCard';
import PillButton from '../components/PillButton';
import BottomSheet from '../components/BottomSheet';

export default function CourseListScreen({ route, navigation }) {
  const { semesterId, semLabel } = route.params;
  const [courses, setCourses]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/semesters/${semesterId}/courses`, { headers: await authHeaders() });
    const data = await res.json();
    setCourses(Array.isArray(data) ? data : []);
  }, [semesterId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  async function createCourse() {
    if (!courseName.trim()) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/semesters/${semesterId}/courses`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ course_name: courseName.trim() }),
      });
      setCreateOpen(false); setCourseName('');
      await load();
    } finally { setSaving(false); }
  }

  function renderItem({ item }) {
    return (
      <Pressable onPress={() => navigation.navigate('Projects', {
        courseId: item.course_id,
        courseName: item.course_name,
      })}>
        {({ pressed }) => (
          <BrutalCard style={[styles.card, pressed && styles.cardPressed]}>
            <Text style={styles.cardTitle}>{item.course_name}</Text>
            <Text style={styles.chevron}>→</Text>
          </BrutalCard>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{semLabel}</Text>
        <Text style={styles.title}>COURSES</Text>
      </View>

      <FlatList
        data={courses}
        keyExtractor={c => c.course_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={!loading && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>□</Text>
            <Text style={styles.emptyText}>No courses in this semester yet.</Text>
          </View>
        )}
      />

      <View style={styles.fab}>
        <PillButton label="+ New Course" onPress={() => setCreateOpen(true)} />
      </View>

      <BottomSheet visible={createOpen} onClose={() => setCreateOpen(false)} title="New Course">
        <Text style={styles.fieldLabel}>COURSE NAME</Text>
        <TextInput
          style={styles.input} value={courseName} onChangeText={setCourseName}
          placeholder="e.g. Machine Learning" placeholderTextColor={colors.textMuted}
          autoFocus
        />
        <PillButton label="Create" onPress={createCourse} loading={saving} style={{ marginTop: spacing.lg }} />
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
