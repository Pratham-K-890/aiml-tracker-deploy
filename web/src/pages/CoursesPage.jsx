import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { getCourses, createCourse, deleteCourse } from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

export default function CoursesPage() {
  const { semId }  = useParams();
  const { state }  = useLocation();
  const navigate   = useNavigate();
  const { role }   = useAuth();
  const batchName  = state?.batchName || '';
  const semLabel   = state?.semLabel  || 'Semester';

  const [courses, setCourses]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [modalOpen, setModal]   = useState(false);
  const [courseName, setName]   = useState('');
  const [courseCode, setCode]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [saveErr, setSaveErr]   = useState('');

  const [editMode, setEditMode]           = useState(false);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const [deleting, setDeleting]           = useState(false);



  async function load() {
    try {
      setCourses(await getCourses(semId) || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [semId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!courseName.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      await createCourse(semId, courseName.trim(), courseCode.trim() || undefined);
      setModal(false); setName(''); setCode('');
      await load();
    } catch (e) { setSaveErr(e.message); }
    finally { setSaving(false); }
  }

  const canCreate = ['admin', 'hod', 'teacher'].includes(role);
  const isAdmin   = ['admin', 'hod'].includes(role);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteCourse(deleteTarget.course_id);
      setDeleteTarget(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/batches">Batches</Link>
          <span className="sep">›</span>
          {state?.batchId
            ? <Link to={`/batches/${state.batchId}/semesters`} state={state}>{batchName || 'Batch'}</Link>
            : <span>{batchName || 'Batch'}</span>
          }
          <span className="sep">›</span>
          <span>{semLabel}</span>
        </div>
        <div className="page-header-row">
          <h2>COURSES</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && (
              <button
                className={`pill-btn${editMode ? '' : ' outline'}`}
                style={editMode ? { background: '#c0392b', borderColor: '#c0392b' } : {}}
                onClick={() => { setEditMode(m => !m); setDeleteTarget(null); }}
              >
                {editMode ? 'Done' : 'Manage'}
              </button>
            )}
            {canCreate && (
              <button className="pill-btn" onClick={() => { setModal(true); setSaveErr(''); }}>+ New Course</button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? <Spinner large center /> : courses.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">□</span>
          <span>No courses yet</span>
        </div>
      ) : (
        <div className="cards-grid">
          {courses.map(c => (
            <div
              key={c.course_id}
              className="brutal-card clickable"
              onClick={() => navigate(`/courses/${c.course_id}/projects`, {
                state: { courseName: c.course_name, courseCode: c.course_code, semLabel, batchName, batchId: state?.batchId },
              })}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  {c.course_code && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent)', marginBottom: 4 }}>
                      {c.course_code}
                    </div>
                  )}
                  <div className="card-title">{c.course_name}</div>
                </div>
                {isAdmin && editMode && (
                  <button
                    className="pill-btn danger"
                    style={{ fontSize: '0.6rem', padding: '4px 10px', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); setDeleteTarget(c); }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="card-chevron">→</div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Course">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
          This will permanently delete{' '}
          <strong style={{ color: 'var(--text)' }}>{deleteTarget?.course_name}</strong> and{' '}
          <strong style={{ color: 'var(--accent)' }}>all projects and student records</strong> under it.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>This cannot be undone.</p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Yes, Delete Everything'}
          </button>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModal(false)} title="New Course">
        <form onSubmit={handleCreate}>
          {saveErr && <div className="alert error">{saveErr}</div>}
          <label className="field-label">Course Code <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
          <input className="text-input" value={courseCode} onChange={e => setCode(e.target.value)}
            placeholder="e.g. 21CS55" />
          <label className="field-label">Course Title</label>
          <input className="text-input" value={courseName} onChange={e => setName(e.target.value)}
            placeholder="e.g. Machine Learning" required />
          <div className="modal-actions">
            <button type="button" className="pill-btn outline" onClick={() => setModal(false)}>Cancel</button>
            <button type="submit" className="pill-btn" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
