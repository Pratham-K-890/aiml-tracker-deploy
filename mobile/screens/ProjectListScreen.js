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

const PLACEHOLDER = 'Not filled';

export default function ProjectListScreen({ route, navigation }) {
  const { courseId, courseName } = route.params;
  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle]           = useState('');
  const [github, setGithub]         = useState('');
  const [guide, setGuide]           = useState('');
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/courses/${courseId}/projects`, { headers: await authHeaders() });
    const data = await res.json();
    setProjects(Array.isArray(data) ? data : []);
  }, [courseId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  async function createProject() {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/courses/${courseId}/projects`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          title:  title.trim()  || null,
          github: github.trim() || null,
          guide:  guide.trim()  || null,
        }),
      });
      setCreateOpen(false); setTitle(''); setGithub(''); setGuide('');
      await load();
    } finally { setSaving(false); }
  }

  function renderItem({ item }) {
    const studentCount = (item.students || []).filter(s => s.usn && s.name).length;
    return (
      <Pressable onPress={() => navigation.navigate('ProjectDetail', { projectId: item.project_id })}>
        {({ pressed }) => (
          <BrutalCard style={[styles.card, pressed && styles.cardPressed]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title || PLACEHOLDER}</Text>
              <View style={styles.metaRow}>
                {item.guide ? <Text style={styles.cardMeta}>Guide: {item.guide}</Text> : null}
                <Text style={styles.cardBadge}>{studentCount} member{studentCount !== 1 ? 's' : ''}</Text>
              </View>
            </View>
            <Text style={styles.chevron}>→</Text>
          </BrutalCard>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{courseName}</Text>
        <Text style={styles.title}>PROJECTS</Text>
      </View>

      <FlatList
        data={projects}
        keyExtractor={p => p.project_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={!loading && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>□</Text>
            <Text style={styles.emptyText}>No projects yet.{'\n'}Create the first one.</Text>
          </View>
        )}
      />

      <View style={styles.fab}>
        <PillButton label="+ New Project" onPress={() => setCreateOpen(true)} />
      </View>

      <BottomSheet visible={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <Text style={styles.fieldLabel}>TITLE (optional)</Text>
        <TextInput
          style={styles.input} value={title} onChangeText={setTitle}
          placeholder="Project title" placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.fieldLabel}>GITHUB LINK (optional)</Text>
        <TextInput
          style={styles.input} value={github} onChangeText={setGithub}
          placeholder="https://github.com/…" placeholderTextColor={colors.textMuted}
          autoCapitalize="none" keyboardType="url"
        />
        <Text style={styles.fieldLabel}>GUIDE NAME (optional)</Text>
        <TextInput
          style={styles.input} value={guide} onChangeText={setGuide}
          placeholder="Dr. …" placeholderTextColor={colors.textMuted}
        />
        <PillButton label="Create" onPress={createProject} loading={saving} style={{ marginTop: spacing.lg }} />
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
  cardTitle: { ...type.heading, color: colors.textInverse },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  cardMeta:  { ...type.label, color: colors.textInverse, opacity: 0.7 },
  cardBadge: {
    ...type.label, color: colors.accent,
    borderWidth: 1, borderColor: colors.accent,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4,
  },
  chevron: { ...type.heading, color: colors.accent, marginLeft: spacing.md },

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
