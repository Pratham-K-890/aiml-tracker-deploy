import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getProject, updateProject, deleteProject,
  getReadme, chatExplain, chatSuggest,
  updateStudent, deleteStudent,
} from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { role }      = useAuth();
  const canEdit       = role !== 'student';

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Edit modal
  const [editOpen, setEditOpen]     = useState(false);
  const [editForm, setEditForm]     = useState({ title: '', github: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr]       = useState('');

  // README
  const [readme, setReadme]               = useState(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  // AI
  const [aiLoading, setAiLoading]   = useState('');
  const [explain, setExplain]       = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [aiErr, setAiErr]           = useState('');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  async function load() {
    try {
      const data = await getProject(projectId);
      setProject(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [projectId]);

  async function loadReadme() {
    setReadmeLoading(true);
    try {
      const r = await getReadme(projectId);
      setReadme(r);
    } catch (e) { setReadme({ found: false, reason: e.message }); }
    finally { setReadmeLoading(false); }
  }

  function openEdit() {
    setEditForm({ title: project.title || '', github: project.github || '' });
    setEditErr('');
    setEditOpen(true);
  }

  async function handleEdit(e) {
    e.preventDefault();
    setEditSaving(true); setEditErr('');
    try {
      const patch = Object.fromEntries(Object.entries(editForm).filter(([, v]) => v.trim()));
      await updateProject(projectId, patch);
      setEditOpen(false);
      await load();
    } catch (e) { setEditErr(e.message); }
    finally { setEditSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteProject(projectId);
      navigate(-1);
    } catch (e) { setError(e.message); setDeleting(false); setDeleteConfirm(false); }
  }

  async function handleExplain() {
    setAiLoading('explain'); setAiErr(''); setExplain(null);
    try { setExplain(await chatExplain(projectId)); }
    catch (e) { setAiErr(e.message); }
    finally { setAiLoading(''); }
  }

  async function handleSuggest() {
    setAiLoading('suggest'); setAiErr(''); setSuggestions(null);
    try { setSuggestions(await chatSuggest(projectId)); }
    catch (e) { setAiErr(e.message); }
    finally { setAiLoading(''); }
  }

  if (loading) return <Spinner large center />;
  if (error)   return <div className="alert error">{error}</div>;
  if (!project) return null;

  const p = project;
  const breadBatch  = p.course?.semester?.batch;
  const breadSem    = p.course?.semester;
  const breadCourse = p.course;

  const guideName = p.guide_profile?.name || p.guide_profile?.email || p.guide || null;
  const teamLabel = p.team_number != null ? `Team ${p.team_number}` : null;

  return (
    <>
      {/* Breadcrumb */}
      <div className="breadcrumb" style={{ marginBottom: 8 }}>
        <Link to="/batches">Batches</Link>
        {breadBatch && (
          <>
            <span className="sep">›</span>
            <Link to={`/batches/${breadBatch.batch_id}/semesters`}
              state={{ batchName: breadBatch.batch_name }}>
              {breadBatch.batch_name}
            </Link>
          </>
        )}
        {breadSem && (
          <>
            <span className="sep">›</span>
            <Link to={`/semesters/${breadSem.semester_id}/courses`}
              state={{ semLabel: `Sem ${breadSem.sem_number}`, batchName: breadBatch?.batch_name, batchId: breadBatch?.batch_id }}>
              Sem {breadSem.sem_number}
            </Link>
          </>
        )}
        {breadCourse && (
          <>
            <span className="sep">›</span>
            <Link to={`/courses/${breadCourse.course_id}/projects`}
              state={{ courseName: breadCourse.course_name, semLabel: `Sem ${breadSem?.sem_number}`, batchName: breadBatch?.batch_name, batchId: breadBatch?.batch_id }}>
              {breadCourse.course_name}
            </Link>
          </>
        )}
        <span className="sep">›</span>
        <span>{p.title || 'Team'}</span>
      </div>

      {/* Header */}
      <div className="page-header-row" style={{ marginBottom: 28 }}>
        <div>
          {teamLabel && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
              {teamLabel}
            </div>
          )}
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>
            {p.title || <span style={{ color: 'var(--text-muted)' }}>Untitled Team</span>}
          </h2>
        </div>
        {canEdit && (
          <div className="flex gap-sm">
            <button className="pill-btn outline" onClick={openEdit}>Edit</button>
            <button className="pill-btn danger" onClick={() => setDeleteConfirm(true)}>Delete</button>
          </div>
        )}
      </div>

      <div className="detail-grid">
        {/* Left: project info + students */}
        <div>
          <div className="brutal-card">
            {/* GitHub */}
            <div className="detail-field">
              <div className="field-key">GitHub</div>
              <div className={`field-val${p.github ? '' : ' muted'}`}>
                {p.github
                  ? <a href={p.github} target="_blank" rel="noreferrer">{p.github}</a>
                  : 'Not set'}
              </div>
            </div>

            {/* Guide */}
            <div className="detail-field">
              <div className="field-key">Guide</div>
              <div className={`field-val${guideName ? '' : ' muted'}`}>
                {guideName || 'Not assigned'}
              </div>
            </div>

            {/* Examiners */}
            <div className="detail-field">
              <div className="field-key">Examiners</div>
              <div className="field-val">
                {p.examiners?.length > 0
                  ? p.examiners.map((ex, i) => (
                      <span key={ex.user_id}>
                        {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>}
                        {ex.name || ex.email}
                      </span>
                    ))
                  : <span className="muted">Not assigned</span>
                }
              </div>
            </div>

            {/* Course */}
            {breadCourse && (
              <div className="detail-field">
                <div className="field-key">Course</div>
                <div className="field-val">{breadCourse.course_name}</div>
              </div>
            )}
          </div>

          {/* Students */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="label text-accent">Team Members</span>
              <span className="badge">{p.students?.length || 0} / 4</span>
            </div>
            {p.students?.length > 0 ? (
              <div className="brutal-card dark" style={{ padding: '4px 0' }}>
                <table className="students-table">
                  <thead>
                    <tr><th>USN</th><th>Name</th></tr>
                  </thead>
                  <tbody>
                    {p.students.map(s => (
                      <tr key={s.student_id}>
                        <td className="mono">{s.usn}</td>
                        <td>{s.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="brutal-card dark" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                No team members yet
              </div>
            )}
          </div>
        </div>

        {/* Right: README + AI */}
        <div>
          {/* README */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="label text-accent">README</span>
              {!readme && (
                <button className="pill-btn outline" style={{ fontSize: '0.65rem', padding: '5px 14px' }}
                  onClick={loadReadme} disabled={readmeLoading}>
                  {readmeLoading ? 'Loading…' : 'Load README'}
                </button>
              )}
            </div>
            {readme && (
              readme.found
                ? <div className="readme-box"><ReactMarkdown>{readme.content}</ReactMarkdown></div>
                : <div className="brutal-card dark" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center' }}>
                    README not available ({readme.reason || 'private or missing'})
                  </div>
            )}
          </div>

          {/* AI Actions */}
          <div className="label text-accent" style={{ marginBottom: 10 }}>AI Insights</div>
          {aiErr && <div className="alert error" style={{ marginBottom: 10 }}>{aiErr}</div>}
          <div className="flex gap-sm" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="pill-btn outline" onClick={handleExplain} disabled={!!aiLoading}>
              {aiLoading === 'explain' ? <><Spinner /> Explaining…</> : '✦ Explain Project'}
            </button>
            <button className="pill-btn outline" onClick={handleSuggest} disabled={!!aiLoading}>
              {aiLoading === 'suggest' ? <><Spinner /> Thinking…</> : '✦ Suggest Improvements'}
            </button>
          </div>

          {explain && (
            <div className="brutal-card dark" style={{ marginBottom: 16 }}>
              <div className="label text-accent" style={{ marginBottom: 8 }}>Summary</div>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text)' }}>{explain.summary}</p>
            </div>
          )}

          {suggestions && (
            <div>
              <div className="label text-accent" style={{ marginBottom: 10 }}>Suggestions</div>
              {suggestions.related?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 6 }}>INSPIRED BY</div>
                  <div className="tag-list">
                    {suggestions.related.map(r => (
                      <a key={r.name} href={r.url} target="_blank" rel="noreferrer" className="tag">
                        ⭐ {r.stars?.toLocaleString()} {r.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="suggest-list">
                {suggestions.suggestions?.map((s, i) => (
                  <div key={i} className="suggest-item">
                    <span className="bullet">◆</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal — title + github only; guide assigned via course page */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Team">
        <form onSubmit={handleEdit}>
          {editErr && <div className="alert error">{editErr}</div>}
          <label className="field-label">Project Title</label>
          <input className="text-input" value={editForm.title}
            onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Smart Attendance System" />
          <label className="field-label">GitHub URL</label>
          <input className="text-input" value={editForm.github}
            onChange={e => setEditForm(f => ({ ...f, github: e.target.value }))}
            placeholder="https://github.com/…" />
          <div className="modal-actions">
            <button type="button" className="pill-btn outline" onClick={() => setEditOpen(false)}>Cancel</button>
            <button type="submit" className="pill-btn" disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Delete Team">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
          Permanently delete <strong style={{ color: 'var(--text)' }}>{p.title || 'this team'}</strong> and all its student records?
        </p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Yes, Delete'}
          </button>
        </div>
      </Modal>
    </>
  );
}
