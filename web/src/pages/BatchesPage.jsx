import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBatches, createBatch, deleteBatch } from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

export default function BatchesPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin  = ['admin', 'hod'].includes(role);

  const [batches, setBatches]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName]           = useState('');
  const [year, setYear]           = useState('');
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');

  const [editMode, setEditMode]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  async function load() {
    try {
      const data = await getBatches();
      setBatches(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteBatch(deleteTarget.batch_id);
      setDeleteTarget(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      await createBatch(name.trim(), year.trim());
      setModalOpen(false); setName(''); setYear('');
      await load();
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <div className="eyebrow">Project Tracker</div>
            <h2>BATCHES</h2>
          </div>
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
            {isAdmin && (
              <button className="pill-btn" onClick={() => { setModalOpen(true); setSaveErr(''); }}>
                + New Batch
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? <Spinner large center /> : batches.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">□</span>
          <span>No batches yet — create the first one</span>
        </div>
      ) : (
        <div className="cards-grid">
          {batches.map(b => {
            const sems = b.semester || [];
            const miniSem  = sems.find(s => s.project_status === 'mini');
            const majorSem = sems.find(s => s.project_status === 'major');
            const miniColor  = miniSem  ? (miniSem.project_active  ? '#22c55e' : '#6b7280') : null;
            const majorColor = majorSem ? (majorSem.project_active ? '#22c55e' : '#6b7280') : null;
            return (
              <div
                key={b.batch_id}
                className="brutal-card clickable"
                onClick={() => navigate(`/batches/${b.batch_id}/semesters`, { state: { batchName: b.batch_name, batchId: b.batch_id } })}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="card-title">{b.batch_name}</div>
                    {b.year && <div className="card-meta">Batch of {b.year}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {miniColor && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 700,
                          color: '#fff', background: miniColor,
                          padding: '2px 8px', borderRadius: 4,
                        }}>
                          {miniSem.project_active ? '● MINI PROJECT' : '○ MINI PROJECT'}
                        </span>
                      )}
                      {majorColor && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 700,
                          color: '#fff', background: majorColor,
                          padding: '2px 8px', borderRadius: 4,
                        }}>
                          {majorSem.project_active ? '● MAJOR PROJECT' : '○ MAJOR PROJECT'}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && editMode && (
                    <button
                      className="pill-btn danger"
                      style={{ fontSize: '0.6rem', padding: '4px 10px', flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); setDeleteTarget(b); }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="card-chevron">→</div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Batch">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
          This will permanently delete batch{' '}
          <strong style={{ color: 'var(--text)' }}>{deleteTarget?.batch_name}</strong> and{' '}
          <strong style={{ color: 'var(--accent)' }}>all semesters, courses, projects, and student records</strong> under it.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>This cannot be undone.</p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Yes, Delete Everything'}
          </button>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Batch">
        <form onSubmit={handleCreate}>
          {saveErr && <div className="alert error">{saveErr}</div>}
          <label className="field-label">Batch Name</label>
          <input className="text-input" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. 2024-2028" required />
          <label className="field-label">Start Year (optional)</label>
          <input className="text-input" value={year} onChange={e => setYear(e.target.value)}
            placeholder="e.g. 2024" type="number" />
          <div className="modal-actions">
            <button type="button" className="pill-btn outline" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="pill-btn" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
