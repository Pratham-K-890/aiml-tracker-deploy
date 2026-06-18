import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, Pressable, Linking,
} from 'react-native';
import { TRACKER, CHATBOT_BASE, authHeaders } from '../config/api';
import { colors, spacing, type, radius } from '../theme';
import BrutalCard from '../components/BrutalCard';
import PillButton from '../components/PillButton';
import BottomSheet from '../components/BottomSheet';

const PLACEHOLDER = 'Not filled';

export default function ProjectDetailScreen({ route }) {
  const { projectId } = route.params;
  const [project, setProject] = useState(null);
  const [readme, setReadme] = useState(null);
  const [readmeReason, setReadmeReason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [explainOpen, setExplainOpen] = useState(false);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explanation, setExplanation] = useState(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestData, setSuggestData] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeaders(true);
    const [pRes, rRes] = await Promise.all([
      fetch(`${TRACKER}/projects/${projectId}`, { headers }),
      fetch(`${TRACKER}/projects/${projectId}/readme`, { headers }),
    ]);
    const p = await pRes.json();
    const r = await rRes.json();
    setProject(p);
    setReadme(r.found ? r.content : null);
    setReadmeReason(r.found ? null : r.reason);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  async function askAi() {
    setExplainOpen(true);
    if (explanation) return;
    setExplainBusy(true);
    try {
      const res = await fetch(`${CHATBOT_BASE}/explain/${projectId}`, {
        method: 'POST', headers: await authHeaders(true),
      });
      const data = await res.json();
      setExplanation(data);
    } finally { setExplainBusy(false); }
  }

  async function suggestImprovements() {
    setSuggestOpen(true);
    if (suggestData) return;
    setSuggestBusy(true);
    try {
      const res = await fetch(`${CHATBOT_BASE}/suggest/${projectId}`, {
        method: 'POST', headers: await authHeaders(true),
      });
      const data = await res.json();
      setSuggestData(data);
    } finally { setSuggestBusy(false); }
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <Text style={styles.eyebrow}>PROJECT</Text>
      <Text style={styles.title}>{project?.title || PLACEHOLDER}</Text>

      <BrutalCard style={styles.metaCard}>
        <MetaRow label="Guide"  value={project?.guide} />
        <MetaRow
          label="GitHub"
          value={project?.github}
          link={!!project?.github}
          onPress={() => project?.github && Linking.openURL(project.github)}
        />
        <MetaRow
          label="Team"
          value={(project?.students || [])
            .map(s => (s.usn && s.name) ? `${s.usn} · ${s.name}` : null)
            .filter(Boolean).join('\n') || null}
        />
      </BrutalCard>

      <View style={styles.actions}>
        <PillButton label="Ask AI" onPress={askAi} />
        <PillButton label="Suggest improvements" variant="outline" onPress={suggestImprovements} />
      </View>

      <Text style={styles.sectionLabel}>README</Text>
      <BrutalCard dark style={styles.readmeCard}>
        {readme ? (
          <Text style={styles.readme}>{readme}</Text>
        ) : (
          <Text style={styles.readmeEmpty}>
            {readmeReason === 'no_github_url'
              ? 'No GitHub link on this project yet.'
              : 'README unreachable — repo may be private or missing.'}
          </Text>
        )}
      </BrutalCard>

      <BottomSheet visible={explainOpen} onClose={() => setExplainOpen(false)} title="What this project does">
        {explainBusy ? (
          <ActivityIndicator color={colors.accent} />
        ) : explanation?.summary ? (
          <Text style={styles.sheetBody}>{explanation.summary}</Text>
        ) : (
          <Text style={styles.sheetBody}>
            {explanation?.reason === 'no_github_url'
              ? 'Add a GitHub link to enable AI explanations.'
              : 'Could not reach this project\'s README.'}
          </Text>
        )}
      </BottomSheet>

      <BottomSheet visible={suggestOpen} onClose={() => setSuggestOpen(false)} title="Improvement ideas">
        {suggestBusy ? (
          <ActivityIndicator color={colors.accent} />
        ) : suggestData ? (
          <ScrollView style={{ maxHeight: 480 }}>
            {!!suggestData.related?.length && (
              <>
                <Text style={styles.sheetEyebrow}>INSPIRED BY</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
                  {suggestData.related.map(r => (
                    <Pressable key={r.name} onPress={() => r.url && Linking.openURL(r.url)}>
                      <BrutalCard style={styles.relCard}>
                        <Text style={styles.relName}>{r.name}</Text>
                        <Text style={styles.relStars}>★ {r.stars ?? 0}</Text>
                        {!!r.description && <Text style={styles.relDesc} numberOfLines={3}>{r.description}</Text>}
                      </BrutalCard>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
            {(suggestData.suggestions || []).map((s, i) => (
              <View key={i} style={styles.suggestRow}>
                <Text style={styles.suggestIndex}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.suggestText}>{s}</Text>
              </View>
            ))}
            {!suggestData.suggestions?.length && (
              <Text style={styles.sheetBody}>No suggestions returned.</Text>
            )}
          </ScrollView>
        ) : null}
      </BottomSheet>
    </ScrollView>
  );
}

function MetaRow({ label, value, link, onPress }) {
  const display = value || PLACEHOLDER;
  const empty = !value;
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      {link && !empty ? (
        <Pressable onPress={onPress}><Text style={[styles.metaValue, styles.metaLink]}>{display}</Text></Pressable>
      ) : (
        <Text style={[styles.metaValue, empty && styles.metaEmpty]}>{display}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl * 2 },

  eyebrow: { ...type.label, color: colors.accent },
  title:   { ...type.display, color: colors.text, marginTop: spacing.xs, marginBottom: spacing.lg },

  metaCard: { marginBottom: spacing.lg },
  metaRow: { marginBottom: spacing.md },
  metaLabel: { ...type.label, color: colors.textInverse, opacity: 0.6 },
  metaValue: { ...type.body, color: colors.textInverse, marginTop: 2 },
  metaLink:  { textDecorationLine: 'underline' },
  metaEmpty: { fontStyle: 'italic', opacity: 0.5 },

  actions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl, flexWrap: 'wrap' },

  sectionLabel: { ...type.label, color: colors.accent, marginBottom: spacing.sm },
  readmeCard: { padding: spacing.lg },
  readme:      { ...type.mono, color: colors.text },
  readmeEmpty: { ...type.body, color: colors.textMuted, fontStyle: 'italic' },

  sheetEyebrow: { ...type.label, color: colors.accent, marginBottom: spacing.sm },
  sheetBody:    { ...type.body, color: colors.text },

  relCard: { width: 220, marginRight: spacing.md, padding: spacing.md },
  relName:  { ...type.bodyBold, color: colors.textInverse },
  relStars: { ...type.label,    color: colors.textInverse, opacity: 0.7, marginTop: 2 },
  relDesc:  { ...type.body,     color: colors.textInverse, marginTop: spacing.sm },

  suggestRow: { flexDirection: 'row', marginBottom: spacing.md, gap: spacing.md },
  suggestIndex: {
    ...type.heading, color: colors.accent, width: 36,
  },
  suggestText: { ...type.body, color: colors.text, flex: 1 },
});
