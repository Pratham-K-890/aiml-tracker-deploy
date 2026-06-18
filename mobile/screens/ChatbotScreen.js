import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { TRACKER, CHATBOT_BASE, authHeaders } from '../config/api';
import { colors, spacing, type, radius, brutalShadow } from '../theme';
import BrutalCard from '../components/BrutalCard';

/**
 * Chat UI for the /chatbot/filter endpoint.
 * User bubbles: amber (right). AI bubbles: navy with amber border (left), and
 * when the AI returns project hits we render brutalist project cards inline.
 */
export default function ChatbotScreen({ navigation }) {
  const [messages, setMessages] = useState([
    { id: 'seed', role: 'ai', text: "Ask me anything — try 'show 6th sem AI projects' or 'projects guided by Dr. Rao'." },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    const userMsg = { id: `u-${Date.now()}`, role: 'user', text: q };
    setMessages(m => [...m, userMsg]);
    setBusy(true);

    try {
      const res = await fetch(`${CHATBOT_BASE}/filter`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Request failed');

      const aiMsg = {
        id: `a-${Date.now()}`,
        role: 'ai',
        text: data.count
          ? `Found ${data.count} project${data.count === 1 ? '' : 's'}.`
          : 'No projects matched that query.',
        projects: data.projects || [],
      };
      setMessages(m => [...m, aiMsg]);
    } catch (e) {
      setMessages(m => [...m, { id: `e-${Date.now()}`, role: 'ai', text: `⚠ ${e.message}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  function openProject(p) {
    navigation?.navigate?.('ProjectDetail', { projectId: p.project_id });
  }

  function renderItem({ item }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
          <Text style={[styles.bubbleText, { color: isUser ? colors.bg : colors.text }]}>
            {item.text}
          </Text>
        </View>

        {!!item.projects?.length && (
          <View style={styles.projectList}>
            {item.projects.slice(0, 5).map(p => (
              <Pressable key={p.project_id} onPress={() => openProject(p)}>
                <BrutalCard style={styles.projectCard}>
                  <Text style={styles.projectTitle}>{p.title || 'Untitled project'}</Text>
                  <Text style={styles.projectMeta}>
                    {p.course?.course_name || '—'} · sem {p.course?.semester?.sem_number ?? '?'} · {p.course?.semester?.batch?.batch_name || ''}
                  </Text>
                  {p.guide ? <Text style={styles.projectGuide}>Guide: {p.guide}</Text> : null}
                </BrutalCard>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <Text style={styles.header}>CHAT</Text>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about projects…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          editable={!busy}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable onPress={send} style={[styles.sendBtn, busy && { opacity: 0.5 }]} disabled={busy}>
          <Text style={styles.sendLabel}>{busy ? '…' : '→'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    ...type.label, color: colors.accent,
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.sm,
  },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  row: { marginBottom: spacing.md, maxWidth: '92%' },
  rowLeft:  { alignSelf: 'flex-start' },
  rowRight: { alignSelf: 'flex-end' },

  bubble: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 2,
  },
  bubbleUser: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleAi:   { backgroundColor: colors.cardDark, borderColor: colors.accent },
  bubbleText: { ...type.body },

  projectList: { marginTop: spacing.md, gap: spacing.md },
  projectCard: { padding: spacing.md },
  projectTitle: { ...type.bodyBold, color: colors.textInverse },
  projectMeta:  { ...type.label, color: colors.textInverse, opacity: 0.7, marginTop: 2 },
  projectGuide: { ...type.body, color: colors.textInverse, marginTop: 4 },

  composer: {
    flexDirection: 'row', padding: spacing.lg, gap: spacing.md,
    borderTopWidth: 2, borderColor: colors.accent, backgroundColor: colors.bgElevated,
  },
  input: {
    flex: 1, color: colors.text,
    backgroundColor: colors.bg,
    borderWidth: 2, borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    ...type.body,
  },
  sendBtn: {
    width: 48, height: 48, borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    ...brutalShadow,
  },
  sendLabel: { ...type.heading, color: colors.bg },
});
