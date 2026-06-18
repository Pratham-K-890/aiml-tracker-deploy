import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { authHeaders, TRACKER } from '../config/api';

// ── Utility ───────────────────────────────────────────────────────────────────

/** Safely traverse nested objects without throwing on nulls. */
function dig(obj, ...keys) {
  return keys.reduce((v, k) => (v != null ? v[k] : undefined), obj);
}

/** Returns the value if non-null/non-empty, otherwise null (renders as "Not filled"). */
function disp(val) {
  return val != null && val !== '' ? String(val) : null;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function StudentListScreen() {
  const [students,    setStudents]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [batches,     setBatches]     = useState([]);
  const [semesters,   setSemesters]   = useState([]);
  const [selBatch,    setSelBatch]    = useState(null);
  const [selSemester, setSelSemester] = useState(null);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editTarget,  setEditTarget]  = useState(null);
  const [editFields,  setEditFields]  = useState({});
  const [saving,      setSaving]      = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res     = await fetch(`${TRACKER}/students`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStudents(data);

      // Derive unique filter options from the loaded data
      const bMap = {}, sMap = {};
      data.forEach((s) => {
        const batch = dig(s, 'project', 'course', 'semester', 'batch');
        const sem   = dig(s, 'project', 'course', 'semester');
        if (batch?.batch_id)  bMap[batch.batch_id]  = batch;
        if (sem?.semester_id) sMap[sem.semester_id] = sem;
      });
      setBatches(Object.values(bMap));
      setSemesters(Object.values(sMap));
    } catch (err) {
      Alert.alert('Error', `Failed to load students: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  // ── Filtering ─────────────────────────────────────────────────────────────────

  const displayed = students.filter((s) => {
    // batch_id lives as a FK on the semester object included in the join
    const bId = dig(s, 'project', 'course', 'semester', 'batch_id');
    // semester_id lives as a FK on the course object included in the join
    const sId = dig(s, 'project', 'course', 'semester_id');

    if (selBatch    && bId !== selBatch)    return false;
    if (selSemester && sId !== selSemester) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (s.usn || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (dig(s, 'project', 'title') || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── Edit ──────────────────────────────────────────────────────────────────────

  function openEdit(student) {
    setEditTarget(student);
    setEditFields({
      usn:    student.usn                              ?? '',
      name:   student.name                             ?? '',
      title:  dig(student, 'project', 'title')         ?? '',
      github: dig(student, 'project', 'github')        ?? '',
      guide:  dig(student, 'project', 'guide')         ?? '',
    });
    setEditVisible(true);
  }

  async function saveEdit() {
    if (!editTarget) return;
    setSaving(true);
    try {
      const hdrs = await authHeaders();

      // Student patch — only include fields that actually changed
      const sPatch = {};
      if (editFields.usn  !== (editTarget.usn  ?? '')) sPatch.usn  = editFields.usn  || null;
      if (editFields.name !== (editTarget.name ?? '')) sPatch.name = editFields.name || null;

      if (Object.keys(sPatch).length > 0) {
        const r = await fetch(`${TRACKER}/students/${editTarget.student_id}`, {
          method: 'PUT', headers: hdrs, body: JSON.stringify(sPatch),
        });
        if (!r.ok) throw new Error(`Student save failed (HTTP ${r.status})`);
      }

      // Project patch — only include changed fields
      const pid = dig(editTarget, 'project', 'project_id');
      if (pid) {
        const pPatch = {};
        if (editFields.title  !== (dig(editTarget, 'project', 'title')  ?? '')) pPatch.title  = editFields.title  || null;
        if (editFields.github !== (dig(editTarget, 'project', 'github') ?? '')) pPatch.github = editFields.github || null;
        if (editFields.guide  !== (dig(editTarget, 'project', 'guide')  ?? '')) pPatch.guide  = editFields.guide  || null;

        if (Object.keys(pPatch).length > 0) {
          const r = await fetch(`${TRACKER}/projects/${pid}`, {
            method: 'PUT', headers: hdrs, body: JSON.stringify(pPatch),
          });
          if (!r.ok) throw new Error(`Project save failed (HTTP ${r.status})`);
        }
      }

      setEditVisible(false);
      loadStudents();  // refresh list
    } catch (err) {
      Alert.alert('Save failed', err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  function confirmDelete(student) {
    Alert.alert(
      'Delete student',
      `Remove ${student.name || student.usn || 'this student'} from the list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => doDelete(student.student_id) },
      ],
    );
  }

  async function doDelete(id) {
    try {
      const headers = await authHeaders();
      const res     = await fetch(`${TRACKER}/students/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStudents((prev) => prev.filter((s) => s.student_id !== id));
    } catch (err) {
      Alert.alert('Delete failed', err.message);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading students…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search by USN, name or project…"
        placeholderTextColor="#9CA3AF"
        value={search}
        onChangeText={setSearch}
      />

      <Chips
        label="Batch"
        items={batches}
        selected={selBatch}
        onSelect={setSelBatch}
        getId={(b) => b.batch_id}
        getLabel={(b) => disp(b.batch_name) ?? '—'}
      />
      <Chips
        label="Semester"
        items={semesters}
        selected={selSemester}
        onSelect={setSelSemester}
        getId={(s) => s.semester_id}
        getLabel={(s) => `Sem ${disp(s.sem_number) ?? '—'}`}
      />

      <Text style={styles.countText}>
        {displayed.length} student{displayed.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={displayed}
        keyExtractor={(s) => s.student_id}
        renderItem={({ item }) => (
          <StudentCard
            student={item}
            onEdit={() => openEdit(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          <Text style={styles.emptyList}>No students found.</Text>
        }
      />

      {/* Edit modal — bottom sheet style */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Edit Student</Text>

            <Field
              label="USN"
              value={editFields.usn}
              onChange={(v) => setEditFields((f) => ({ ...f, usn: v }))}
            />
            <Field
              label="Name"
              value={editFields.name}
              onChange={(v) => setEditFields((f) => ({ ...f, name: v }))}
            />

            <Text style={styles.sectionLabel}>Project details</Text>
            <Field
              label="Title"
              value={editFields.title}
              onChange={(v) => setEditFields((f) => ({ ...f, title: v }))}
            />
            <Field
              label="GitHub URL"
              value={editFields.github}
              onChange={(v) => setEditFields((f) => ({ ...f, github: v }))}
              keyboardType="url"
            />
            <Field
              label="Guide"
              value={editFields.guide}
              onChange={(v) => setEditFields((f) => ({ ...f, guide: v }))}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEditVisible(false)}
                disabled={saving}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn, saving && styles.disabled]}
                onPress={saveEdit}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StudentCard({ student, onEdit, onDelete }) {
  const project  = student.project  ?? {};
  const course   = project.course   ?? {};
  const semester = course.semester  ?? {};
  const batch    = semester.batch   ?? {};

  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* USN — bold identifier */}
        <Text style={styles.usn}>
          {disp(student.usn) ?? <Text style={styles.notFilled}>Not filled</Text>}
        </Text>

        {/* Student name */}
        <Text style={styles.studentName}>
          {disp(student.name) ?? <Text style={styles.notFilled}>Not filled</Text>}
        </Text>

        <MetaRow icon="📁" val={disp(project.title)} />
        <MetaRow icon="📚" val={disp(course.course_name)} />
        <MetaRow
          icon="🏛"
          val={batch.batch_name
            ? `${batch.batch_name} · Sem ${disp(semester.sem_number) ?? '—'}`
            : null}
        />
        {disp(project.guide) && <MetaRow icon="👨‍🏫" val={project.guide} />}
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity style={[styles.rowBtn, styles.editBtn]} onPress={onEdit}>
          <Text style={styles.rowBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.rowBtn, styles.deleteBtn]} onPress={onDelete}>
          <Text style={styles.rowBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MetaRow({ icon, val }) {
  return (
    <Text style={styles.meta}>
      {icon}{' '}
      {val != null ? val : <Text style={styles.notFilled}>Not filled</Text>}
    </Text>
  );
}

function Chips({ label, items, selected, onSelect, getId, getLabel }) {
  if (!items.length) return null;
  return (
    <View style={styles.chipRow}>
      <Text style={styles.chipRowLabel}>{label}:</Text>
      <Chip active={!selected} label="All" onPress={() => onSelect(null)} />
      {items.map((item) => {
        const id = getId(item);
        return (
          <Chip
            key={id}
            active={selected === id}
            label={getLabel(item)}
            onPress={() => onSelect(selected === id ? null : id)}
          />
        );
      })}
    </View>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChange, keyboardType = 'default' }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={`Enter ${label.toLowerCase()}…`}
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F5F6FA', paddingHorizontal: 14, paddingTop: 14 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },

  search: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 14, color: '#111827',
    borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10,
  },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 },
  chipRowLabel: { fontSize: 12, color: '#6B7280', marginRight: 6 },
  chip: {
    borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6,
    marginBottom: 4, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#fff',
  },
  chipActive:    { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  chipText:      { fontSize: 12, color: '#374151' },
  chipTextActive:{ color: '#fff' },

  countText: { fontSize: 12, color: '#9CA3AF', marginBottom: 8 },
  emptyList: { textAlign: 'center', color: '#9CA3AF', marginTop: 40, fontSize: 14 },
  notFilled: { color: '#D1D5DB', fontStyle: 'italic', fontSize: 12 },

  // Student card
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'flex-start',
    elevation: 1, borderWidth: 1, borderColor: '#F3F4F6',
  },
  cardBody:    { flex: 1 },
  cardActions: { gap: 8, paddingLeft: 8 },
  usn:         { fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 2 },
  studentName: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 6 },
  meta:        { fontSize: 12, color: '#6B7280', marginBottom: 2 },

  rowBtn:    { borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  editBtn:   { backgroundColor: '#3B82F6' },
  deleteBtn: { backgroundColor: '#EF4444' },
  rowBtnText:{ color: '#fff', fontSize: 12, fontWeight: '600' },

  // Edit modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  sheetTitle:   { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: 16,
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  fieldWrap:  { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 4 },
  fieldInput: {
    backgroundColor: '#F9FAFB', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, color: '#111827',
    borderWidth: 1, borderColor: '#E5E7EB',
  },

  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn:     { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  cancelBtn:    { backgroundColor: '#F3F4F6' },
  saveBtn:      { backgroundColor: '#10B981' },
  cancelText:   { color: '#374151', fontWeight: '600', fontSize: 15 },
  saveText:     { color: '#fff', fontWeight: '600', fontSize: 15 },
  disabled:     { opacity: 0.6 },
});
