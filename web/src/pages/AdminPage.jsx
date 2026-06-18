import { useEffect, useRef, useState } from 'react';
import {
  getAdminUsers, getAdminCourses, getAdminCoordinators,
  assignCoordinator, removeCoordinator, deleteUser,
  createTeacher, createStudent, previewStudents, uploadStudents,
  adminResetPassword,
} from '../api';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const TABS = ['Accounts', 'Coordinators', 'Users'];

export default function AdminPage() {
  const [tab, setTab] = useState('Accounts');

  const [users, setUsers]         = useState([]);
  const [courses, setCourses]     = useState([]);
  const [coordinators, setCoords] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [u, c, co] = await Promise.all([
        getAdminUsers(),
        getAdminCourses(),
        getAdminCoordinators(),
      ]);
      setUsers(u || []);
      setCourses(c || []);
      setCoords(co || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Spinner large center />;

  const teachers  = users.filter(u => u.role === 'teacher' || u.role === 'hod');
  const students  = users.filter(u => u.role === 'student');

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <div className="eyebrow">Administration</div>
            <h2>ADMIN PANEL</h2>
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        {[
          { label: 'Teachers', value: teachers.length },
          { label: 'Students', value: students.length },
          { label: 'Courses', value: courses.length },
          { label: 'Coordinator assignments', value: coordinators.length },
        ].map(s => (
          <div key={s.label} className="brutal-card" style={{ minWidth: 140, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--accent)', fontWeight: 800 }}>
              {s.value}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {s.label.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 32, borderBottom: '2px solid var(--accent-soft)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', padding: '10px 20px',
            fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
            color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -2,
          }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Accounts'     && <AccountsTab onRefresh={load} />}
      {tab === 'Coordinators' && <CoordinatorsTab teachers={teachers} courses={courses} coordinators={coordinators} onRefresh={load} />}
      {tab === 'Users'        && <UsersTab teachers={teachers} students={students} onRefresh={load} />}
    </>
  );
}


// ── Accounts tab ─────────────────────────────────────────────────────────────

function AccountsTab({ onRefresh }) {
  const [subTab, setSubTab] = useState('teacher');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['teacher', 'Create Teacher'], ['student', 'Create Student'], ['bulk', 'Bulk Student Upload']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} className={subTab === k ? 'pill-btn' : 'pill-btn outline'}>
            {l}
          </button>
        ))}
      </div>

      {subTab === 'teacher' && <CreateTeacherForm onSuccess={onRefresh} />}
      {subTab === 'student' && <CreateStudentForm onSuccess={onRefresh} />}
      {subTab === 'bulk'    && <BulkStudentUpload onSuccess={onRefresh} />}
    </div>
  );
}

function CreateTeacherForm({ onSuccess }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'teacher' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [ok, setOk]         = useState('');

  async function handle(e) {
    e.preventDefault();
    setSaving(true); setErr(''); setOk('');
    try {
      const res = await createTeacher(form.name, form.email, form.password, form.role);
      setOk(`Account created for ${res.email} (${res.role})`);
      setForm({ name: '', email: '', password: '', role: 'teacher' });
      onSuccess();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="brutal-card" style={{ maxWidth: 480 }}>
      <div className="label text-accent" style={{ marginBottom: 16 }}>New Teacher Account</div>
      {err && <div className="alert error">{err}</div>}
      {ok  && <div className="alert success">✓ {ok}</div>}
      <form onSubmit={handle}>
        <label className="field-label">Full Name</label>
        <input className="text-input" value={form.name} onChange={field('name')} placeholder="Dr. Jane Smith" required />
        <label className="field-label">Email</label>
        <input className="text-input" type="email" value={form.email} onChange={field('email')} placeholder="jane@college.edu" required />
        <label className="field-label">Password</label>
        <input className="text-input" type="password" value={form.password} onChange={field('password')} placeholder="min 6 characters" minLength={6} required />
        <label className="field-label">Role</label>
        <select className="text-input" value={form.role} onChange={field('role')}>
          <option value="teacher">Teacher</option>
          <option value="hod">HOD</option>
          <option value="admin">Admin</option>
        </select>
        {form.role === 'hod' && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 8 }}>
            ⚠ There should only be one HOD account.
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <button className="pill-btn" type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateStudentForm({ onSuccess }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', usn: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [ok, setOk]         = useState('');

  async function handle(e) {
    e.preventDefault();
    setSaving(true); setErr(''); setOk('');
    try {
      const res = await createStudent(form.name, form.email, form.password, form.usn);
      setOk(`Student account created for ${res.email}`);
      setForm({ name: '', email: '', password: '', usn: '' });
      onSuccess();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="brutal-card" style={{ maxWidth: 480 }}>
      <div className="label text-accent" style={{ marginBottom: 16 }}>New Student Account</div>
      {err && <div className="alert error">{err}</div>}
      {ok  && <div className="alert success">✓ {ok}</div>}
      <form onSubmit={handle}>
        <label className="field-label">Full Name</label>
        <input className="text-input" value={form.name} onChange={field('name')} placeholder="Alice Kumar" required />
        <label className="field-label">USN</label>
        <input className="text-input" value={form.usn} onChange={field('usn')} placeholder="1CS21CS001" />
        <label className="field-label">Email</label>
        <input className="text-input" type="email" value={form.email} onChange={field('email')} placeholder="alice@college.edu" required />
        <label className="field-label">Password</label>
        <input className="text-input" type="password" value={form.password} onChange={field('password')} placeholder="min 6 characters" minLength={6} required />
        <div style={{ marginTop: 20 }}>
          <button className="pill-btn" type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </form>
    </div>
  );
}

function BulkStudentUpload({ onSuccess }) {
  const fileRef           = useRef();
  const [preview, setPreview]   = useState(null);
  const [file, setFile]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [err, setErr]           = useState('');

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setErr(''); setResult(null); setPreview(null);
    setLoading(true);
    try {
      const data = await previewStudents(f);
      setPreview(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); e.target.value = ''; }
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const data = await uploadStudents(file);
      setResult(data);
      setPreview(null);
      setFile(null);
      onSuccess();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div className="brutal-card" style={{ maxWidth: 600, marginBottom: 20 }}>
        <div className="label text-accent" style={{ marginBottom: 8 }}>Expected Format</div>
        <div className="brutal-card dark" style={{ padding: '10px 14px' }}>
          <table className="students-table" style={{ fontSize: '0.75rem' }}>
            <thead>
              <tr>
                {['sl.no', 'usn', 'name', 'email', 'password'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>1</td>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>1CS21CS001</td>
                <td style={{ color: 'var(--text-muted)' }}>Alice Kumar</td>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>alice@college.edu</td>
                <td style={{ color: 'var(--text-muted)' }}>••••••</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {err && <div className="alert error">{err}</div>}

      {result && (
        <div className="alert success" style={{ marginBottom: 16 }}>
          ✓ {result.created} created · {result.skipped} skipped
          {result.errors?.length > 0 && ` · ${result.errors.length} errors`}
        </div>
      )}

      {!preview ? (
        <div
          className="upload-zone"
          style={{ maxWidth: 480 }}
          onClick={() => !loading && fileRef.current?.click()}
        >
          {loading
            ? <><Spinner /><p style={{ marginTop: 8 }}>Parsing…</p></>
            : <><div className="upload-icon">⊡</div><p>Click to select .xlsx file to preview</p></>
          }
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="label text-accent">Preview — {preview.count} students</span>
            <button className="pill-btn outline" onClick={() => { setPreview(null); setFile(null); }}
              style={{ fontSize: '0.65rem' }}>
              Cancel
            </button>
          </div>
          <div className="brutal-card dark" style={{ padding: '4px 0', marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
            <table className="students-table">
              <thead>
                <tr><th>#</th><th>USN</th><th>Name</th><th>Email</th><th>Password</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.sl_no || i + 1}</td>
                    <td className="mono">{r.usn || '—'}</td>
                    <td>{r.name || '—'}</td>
                    <td className="mono">{r.email}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.password_set ? '••••••' : <span style={{ color: 'var(--danger)' }}>missing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="pill-btn" onClick={handleUpload} disabled={loading}>
            {loading ? <><Spinner /> Creating accounts…</> : `Confirm & Create ${preview.count} Accounts`}
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}


// ── Coordinators tab ──────────────────────────────────────────────────────────

function CoordinatorsTab({ teachers, courses, coordinators, onRefresh }) {
  const [selUser, setSelUser]     = useState('');
  const [selCourse, setSelCourse] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignErr, setAssignErr] = useState('');
  const [removing, setRemoving]   = useState('');
  const [err, setErr]             = useState('');

  async function handleAssign(e) {
    e.preventDefault();
    if (!selUser || !selCourse) return;
    setAssigning(true); setAssignErr('');
    try {
      await assignCoordinator(selUser, selCourse);
      setSelUser(''); setSelCourse('');
      onRefresh();
    } catch (e) { setAssignErr(e.message); }
    finally { setAssigning(false); }
  }

  async function handleRemove(course_id, user_id) {
    setRemoving(`${course_id}-${user_id}`);
    try { await removeCoordinator(course_id, user_id); onRefresh(); }
    catch (e) { setErr(e.message); }
    finally { setRemoving(''); }
  }

  return (
    <>
      {err && <div className="alert error">{err}</div>}

      <section style={{ marginBottom: 40 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--text)', marginBottom: 16 }}>
          Assign Coordinator
        </h3>
        <div className="brutal-card">
          {assignErr && <div className="alert error">{assignErr}</div>}
          <form onSubmit={handleAssign} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="field-label">Teacher</label>
              <select className="text-input" value={selUser} onChange={e => setSelUser(e.target.value)} required>
                <option value="">Select teacher…</option>
                {teachers.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.email} ({u.role})</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="field-label">Course</label>
              <select className="text-input" value={selCourse} onChange={e => setSelCourse(e.target.value)} required>
                <option value="">Select course…</option>
                {courses.map(c => {
                  const sem   = c.semester;
                  const batch = sem?.batch;
                  const label = [c.course_code, c.course_name, batch?.batch_name && `(${batch.batch_name} Sem ${sem?.sem_number})`]
                    .filter(Boolean).join(' — ');
                  return <option key={c.course_id} value={c.course_id}>{label}</option>;
                })}
              </select>
            </div>
            <button className="pill-btn" type="submit" disabled={assigning}>
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          </form>
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--text)', marginBottom: 16 }}>
          Current Assignments ({coordinators.length})
        </h3>
        {coordinators.length === 0 ? (
          <div className="empty-state"><span>No assignments yet.</span></div>
        ) : (
          <div className="brutal-card dark" style={{ padding: '4px 0' }}>
            <table className="students-table">
              <thead>
                <tr><th>Teacher</th><th>Course</th><th>Code</th><th></th></tr>
              </thead>
              <tbody>
                {coordinators.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name || c.email || c.user_id.slice(0, 8) + '…'}</td>
                    <td>{c.course_name || c.course_id}</td>
                    <td className="mono">{c.course_code || '—'}</td>
                    <td>
                      <button
                        onClick={() => handleRemove(c.course_id, c.user_id)}
                        disabled={removing === `${c.course_id}-${c.user_id}`}
                        style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '3px 8px', cursor: 'pointer' }}
                      >
                        {removing === `${c.course_id}-${c.user_id}` ? '…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}


// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ teachers, students, onRefresh }) {
  const [deletingId, setDeletingId]   = useState('');
  const [err, setErr]                 = useState('');
  const [resetTarget, setResetTarget] = useState(null); // { id, name }
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting]     = useState(false);
  const [resetOk, setResetOk]         = useState('');
  const [resetErr, setResetErr]       = useState('');

  async function handleDelete(userId, label) {
    if (!window.confirm(`Delete account for ${label}? This cannot be undone.`)) return;
    setDeletingId(userId); setErr('');
    try { await deleteUser(userId); onRefresh(); }
    catch (e) { setErr(e.message); }
    finally { setDeletingId(''); }
  }

  function openReset(u) {
    setResetTarget(u);
    setNewPassword('');
    setResetErr('');
    setResetOk('');
  }

  async function handleReset(e) {
    e.preventDefault();
    setResetting(true); setResetErr(''); setResetOk('');
    try {
      await adminResetPassword(resetTarget.id, newPassword);
      setResetOk(`Password reset for ${resetTarget.name || resetTarget.email}.`);
      setNewPassword('');
    } catch (e) { setResetErr(e.message); }
    finally { setResetting(false); }
  }

  function UserTable({ title, rows }) {
    return (
      <section style={{ marginBottom: 36 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--text)', marginBottom: 16 }}>
          {title} ({rows.length})
        </h3>
        {rows.length === 0 ? (
          <div className="empty-state"><span>None yet.</span></div>
        ) : (
          <div className="brutal-card dark" style={{ padding: '4px 0' }}>
            <table className="students-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>USN</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map(u => (
                  <tr key={u.id}>
                    <td>{u.name || '—'}</td>
                    <td className="mono">{u.email}</td>
                    <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent)' }}>{u.role}</span></td>
                    <td className="mono">{u.usn || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openReset(u)}
                        style={{ background: 'none', border: '1px solid var(--accent-soft)', borderRadius: 4, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '3px 8px', cursor: 'pointer' }}
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.name || u.email)}
                        disabled={deletingId === u.id}
                        style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '3px 8px', cursor: 'pointer' }}
                      >
                        {deletingId === u.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      {err && <div className="alert error">{err}</div>}
      <UserTable title="Teachers" rows={teachers} />
      <UserTable title="Students" rows={students} />

      {resetTarget && (
        <Modal open={true} title={`Reset Password — ${resetTarget.name || resetTarget.email}`} onClose={() => setResetTarget(null)}>
          {resetErr && <div className="alert error">{resetErr}</div>}
          {resetOk  && <div className="alert success">✓ {resetOk}</div>}
          <form onSubmit={handleReset}>
            <label className="field-label">New Password</label>
            <input
              className="text-input"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="min 6 characters"
              minLength={6}
              required
              autoFocus
            />
            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button className="pill-btn" type="submit" disabled={resetting}>
                {resetting ? 'Saving…' : 'Reset Password'}
              </button>
              <button className="pill-btn outline" type="button" onClick={() => setResetTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
