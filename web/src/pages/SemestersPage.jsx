import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { getSemesters, createSemester, clearSemesterProjects, updateSemesterStatus } from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

const ALL_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function SemestersPage() {
  const { batchId } = useParams();
  const { state }   = useLocation();
  const navigate    = useNavigate();
  const { role }    = useAuth();
  const isAdmin     = ['admin', 'hod'].includes(role);
  const isTeacher   = ['admin', 'hod', 'teacher'].includes(role);
  const batchName   = state?.batchName || 'Batch';

  const [existing, setExisting]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [creating, setCreating]     = useState(null);
  const [editMode, setEditMode]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);   // semester object
  const [statusForm, setStatusForm]     = useState({ type: null, active: false });
  const [statusSaving, setStatusSaving] = useState(false);

  async function load() {
    try {
      const data = await getSemesters(batchId);
      setExisting(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [batchId]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await clearSemesterProjects(deleteTarget.semester_id);
      setDeleteTarget(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }

  function openStatusModal(sem) {
    setStatusTarget(sem);
    setStatusForm({ type: sem.project_status ?? null, active: sem.project_active ?? false });
  }

  async function handleStatusSave() {
    setStatusSaving(true);
    try {
      await updateSemesterStatus(statusTarget.semester_id, statusForm.type, statusForm.active);
      setStatusTarget(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setStatusSaving(false); }
  }

  async function handleSemClick(num) {
    const found = existing.find(s => s.sem_number === num);
    if (found) {
      navigate(`/semesters/${found.semester_id}/courses`, {
        state: { semLabel: `Sem ${num}`, batchName, batchId, semId: found.semester_id },
      });
      return;
    }
    setCreating(num);
    try {
      const created = await createSemester(batchId, num);
      navigate(`/semesters/${created.semester_id}/courses`, {
        state: { semLabel: `Sem ${num}`, batchName, batchId, semId: created.semester_id },
      });
    } catch (e) {
      setError(e.message);
      setCreating(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/batches">Batches</Link>
          <span className="sep">›</span>
          <span>{batchName}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h2>SEMESTERS</h2>
          {isAdmin && (
            <button
              className={`pill-btn${editMode ? '' : ' outline'}`}
              style={{ ...(editMode ? { background: '#c0392b', borderColor: '#c0392b' } : {}), marginLeft: 12 }}
              onClick={() => { setEditMode(m => !m); setDeleteTarget(null); }}
            >
              {editMode ? 'Done' : 'Manage'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? <Spinner large center /> : (
        <div className="sem-grid">
          {ALL_SEMS.map(num => {
            const exists = existing.find(s => s.sem_number === num);
            const busy   = creating === num;
            const status = exists?.project_status ?? null;
            const active = exists?.project_active ?? false;
            const statusColor = status === 'mini'
              ? (active ? '#22c55e' : '#6b7280')
              : status === 'major'
              ? (active ? '#22c55e' : '#6b7280')
              : null;
            const statusLabel = status === 'mini'
              ? (active ? '● MINI' : '○ MINI')
              : status === 'major'
              ? (active ? '● MAJOR' : '○ MAJOR')
              : exists ? 'open' : 'create';

            return (
              <div key={num} style={{ position: 'relative' }}>
                <button
                  className={`sem-chip${exists ? ' exists' : ''}`}
                  onClick={() => handleSemClick(num)}
                  disabled={!!creating}
                  style={{
                    width: '100%', height: '100%',
                    ...(statusColor ? {
                      border: `2.5px solid ${statusColor}`,
                      boxShadow: `4px 4px 0 ${statusColor}`,
                    } : {}),
                  }}
                >
                  {busy
                    ? <span className="spinner" />
                    : <span className="sem-num" style={statusColor ? { color: statusColor } : undefined}>{num}</span>
                  }
                  <span className="sem-label" style={statusColor ? { color: statusColor, fontWeight: 700 } : undefined}>
                    {statusLabel}
                  </span>
                </button>

                {/* Delete × — inside card, top-right, manage mode only */}
                {isAdmin && editMode && exists && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(exists); }}
                    disabled={!!creating}
                    title="Delete semester"
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 22, height: 22, borderRadius: '50%',
                      background: '#c0392b', color: '#fff', border: 'none',
                      fontSize: '0.8rem', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, zIndex: 2,
                    }}
                  >
                    ×
                  </button>
                )}

                {/* ⚙ status — inside card, bottom-right */}
                {isTeacher && exists && (
                  <button
                    onClick={e => { e.stopPropagation(); openStatusModal(exists); }}
                    disabled={!!creating}
                    title="Set project status"
                    style={{
                      position: 'absolute', bottom: 8, right: 8,
                      width: 22, height: 22, borderRadius: '50%',
                      background: statusColor || 'var(--accent)', color: '#fff', border: 'none',
                      fontSize: '0.7rem', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, zIndex: 2,
                    }}
                  >
                    ⚙
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!statusTarget} onClose={() => setStatusTarget(null)} title={`Sem ${statusTarget?.sem_number} — Project Status`}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 14, fontSize: '0.85rem' }}>
          Set the project type for this semester, then toggle whether it's currently active.
        </p>

        {/* Type picker */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Project Type
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {[
            { value: null,    label: 'None',          desc: 'No project assigned',   color: 'var(--text-muted)' },
            { value: 'mini',  label: 'Mini Project',  desc: 'Mini project semester',  color: '#22c55e' },
            { value: 'major', label: 'Major Project', desc: 'Major project semester', color: '#22c55e' },
          ].map(opt => (
            <label
              key={String(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', padding: '10px 12px',
                border: `2px solid ${statusForm.type === opt.value ? opt.color : 'var(--border)'}`,
                borderRadius: 6, background: statusForm.type === opt.value ? 'var(--bg-card)' : 'transparent',
              }}
            >
              <input
                type="radio" name="proj_type"
                checked={statusForm.type === opt.value}
                onChange={() => setStatusForm(f => ({ type: opt.value, active: opt.value ? f.active : false }))}
                style={{ accentColor: opt.color }}
              />
              <div>
                <div style={{ fontWeight: 700, color: opt.color, fontFamily: 'var(--font-display)', fontSize: '0.9rem' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Active toggle — only shown when a type is selected */}
        {statusForm.type && (
          <>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Active Status
            </div>
            <label
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', padding: '12px 14px', marginBottom: 20,
                border: `2px solid ${statusForm.active ? '#22c55e' : 'var(--border)'}`,
                borderRadius: 6, background: statusForm.active ? 'var(--bg-card)' : 'transparent',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: statusForm.active ? '#22c55e' : 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: '0.9rem' }}>
                  {statusForm.active ? '● Currently Active' : '○ Not Active'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {statusForm.active ? 'Project is running right now' : 'Project type set but not running'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={statusForm.active}
                onChange={e => setStatusForm(f => ({ ...f, active: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: '#22c55e' }}
              />
            </label>
          </>
        )}

        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setStatusTarget(null)} disabled={statusSaving}>Cancel</button>
          <button className="pill-btn" onClick={handleStatusSave} disabled={statusSaving}>
            {statusSaving ? 'Saving…' : 'Update Status'}
          </button>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Clear Semester Projects">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
          This will permanently delete all{' '}
          <strong style={{ color: 'var(--accent)' }}>projects and student records</strong> inside{' '}
          <strong style={{ color: 'var(--text)' }}>Semester {deleteTarget?.sem_number}</strong>.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 4 }}>
          The semester card and its courses will remain.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>This cannot be undone.</p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Clearing…' : 'Yes, Clear Projects'}
          </button>
        </div>
      </Modal>
    </>
  );
}
