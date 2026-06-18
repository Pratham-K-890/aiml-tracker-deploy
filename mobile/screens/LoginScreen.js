import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, type, radius } from '../theme';
import PillButton from '../components/PillButton';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY    = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export default function LoginScreen({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function login() {
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
      await AsyncStorage.setItem('auth_token', data.access_token);
      onLogin();
    } catch (e) {
      Alert.alert('Login failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>PROJECT TRACKER</Text>
      <Text style={styles.title}>SIGN IN</Text>

      <Text style={styles.label}>EMAIL</Text>
      <TextInput
        style={styles.input} value={email} onChangeText={setEmail}
        placeholder="you@example.com" placeholderTextColor={colors.textMuted}
        autoCapitalize="none" keyboardType="email-address"
      />
      <Text style={styles.label}>PASSWORD</Text>
      <TextInput
        style={styles.input} value={password} onChangeText={setPassword}
        placeholder="••••••••" placeholderTextColor={colors.textMuted}
        secureTextEntry
      />
      <PillButton label="Sign in" onPress={login} loading={loading} style={{ marginTop: spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center' },
  eyebrow: { ...type.label, color: colors.accent },
  title:   { ...type.display, color: colors.text, marginBottom: spacing.xl },
  label:   { ...type.label, color: colors.accent, marginTop: spacing.lg, marginBottom: spacing.xs },
  input:   {
    borderWidth: 2, borderColor: colors.accent, borderRadius: radius.sm,
    color: colors.text, padding: spacing.md, ...type.body,
  },
});
