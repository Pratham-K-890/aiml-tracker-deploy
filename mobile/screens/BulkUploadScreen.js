import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders, TRACKER } from '../config/api';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function BulkUploadScreen() {
  const [downloading, setDownloading] = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [result,      setResult]      = useState(null); // { inserted, skipped, errors }

  // ── Download template ──────────────────────────────────────────────────────

  async function handleDownload() {
    setDownloading(true);
    try {
      const headers = await authHeaders(false);
      const destUri = `${FileSystem.documentDirectory}project_tracker_template.xlsx`;

      const { status } = await FileSystem.downloadAsync(
        `${TRACKER}/download-template`,
        destUri,
        { headers },
      );
      if (status !== 200) throw new Error(`Server returned status ${status}`);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destUri, {
          mimeType:    XLSX_MIME,
          dialogTitle: 'Open or save the Excel template',
          UTI:         'com.microsoft.excel.xlsx',
        });
      } else {
        Alert.alert('Downloaded', `Saved to:\n${destUri}`);
      }
    } catch (err) {
      Alert.alert('Download failed', err.message);
    } finally {
      setDownloading(false);
    }
  }

  // ── Upload Excel ───────────────────────────────────────────────────────────

  async function handleUpload() {
    const picked = await DocumentPicker.getDocumentAsync({
      type:                 XLSX_MIME,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    setUploading(true);
    setResult(null);

    try {
      const headers = await authHeaders(false); // multipart — let fetch set Content-Type
      const form    = new FormData();
      form.append('file', {
        uri:  asset.uri,
        name: asset.name ?? 'upload.xlsx',
        type: XLSX_MIME,
      });

      const res = await fetch(`${TRACKER}/upload-excel`, {
        method:  'POST',
        headers: { Authorization: headers.Authorization },
        body:    form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail);
      }

      setResult(await res.json());
    } catch (err) {
      Alert.alert('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Bulk Upload via Excel</Text>
      <Text style={styles.subtitle}>
        Download the template, fill in student data, then upload to import all
        records at once.
      </Text>

      <ActionButton
        label="⬇  Download Template"
        onPress={handleDownload}
        loading={downloading}
        color="#3B82F6"
      />
      <ActionButton
        label="⬆  Upload Excel (.xlsx)"
        onPress={handleUpload}
        loading={uploading}
        color="#10B981"
      />

      {uploading && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.progressText}>Processing file, please wait…</Text>
        </View>
      )}

      {result && <ResultCard result={result} />}
    </ScrollView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionButton({ label, onPress, loading, color }) {
  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: color }, loading && styles.disabled]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading
        ? <ActivityIndicator color="#fff" />
        : <Text style={styles.btnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function ResultCard({ result: { inserted, skipped, errors } }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Upload Complete</Text>

      <View style={styles.badgeRow}>
        <Badge count={inserted}      label="Inserted" color="#10B981" />
        <Badge count={skipped}       label="Skipped"  color="#F59E0B" />
        <Badge count={errors.length} label="Errors"   color="#EF4444" />
      </View>

      {errors.length > 0 && (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Row errors</Text>
          {errors.map((e, i) => (
            <Text key={i} style={styles.errorItem}>
              Row {e.row}: {e.error}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function Badge({ count, label, color }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeCount, { color }]}>{count}</Text>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { padding: 24, backgroundColor: '#F5F6FA', flexGrow: 1 },
  title:        { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 6 },
  subtitle:     { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 28 },

  btn: {
    borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    marginBottom: 12, elevation: 2,
  },
  btnText:  { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.55 },

  progressBox:  { alignItems: 'center', paddingVertical: 24 },
  progressText: { marginTop: 10, color: '#6B7280', fontSize: 14 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20,
    marginTop: 20, elevation: 3,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },

  badgeRow:   { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  badge: {
    alignItems: 'center', padding: 12, borderRadius: 10,
    borderWidth: 2, minWidth: 82,
  },
  badgeCount: { fontSize: 26, fontWeight: '700' },
  badgeLabel: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  errorBlock: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 12 },
  errorTitle: { fontSize: 13, fontWeight: '600', color: '#EF4444', marginBottom: 8 },
  errorItem:  { fontSize: 13, color: '#6B7280', marginBottom: 4 },
});
