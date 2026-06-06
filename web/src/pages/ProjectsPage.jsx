import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  getProjects, deleteProject,
  getReviews, createReview, updateReview, deleteReview,
  getTeachers, isCourseCoordinator, createTeam,
  uploadCourseExcel, courseTemplateUrl,
  assignGuide, addExaminer, removeExaminer,
  getMyGuideTeams, getMyExamTeams,
} from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

const STUDENT_SLOTS = [0, 1, 2, 3];

export default function ProjectsPage() {
  const { courseId }  = useParams();
  const { state }     = useLocation();
  const navigate      = useNavigate();
  const { role }      = useAuth();
  const courseName    = state?.courseName || 'Course';
  const semLabel      = state?.semLabel   || '';
  const batchName     = state?.batchName  || '';

  const isTeacher     = ['hod', 'admin', 'teacher'].includes(role);
  const isAdminLevel  = ['hod', 'admin'].includes(role);

  // coordinator status is resolved via API (teachers can also be coordinators)
  const [isCoordinator, setIsCoordinator] = useState(isAdminLevel);

  const [projects,    setProjects]    = useState([]);
  const [guideTeams,  setGuideTeams]  = useState([]);
  const [examTeams,   setExamTeams]   = useState([]);
  const [reviews,     setReviews]     = useState([]);
  const [teachers,    setTeachers]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  // view tabs for non-coordinator teachers
  const [tab, setTab] = useState('all'); // 'all' | 'guide' | 'exam'

  // view tabs for coordinators
  const [coordTab, setCoordTab] = useState('all'); // 'all' | 'guide' | 'exam'

  // assign mode
  const [assignMode,        setAssignMode]        = useState(null); // null | 'guide' | 'examiner'
  const [assignMenuOpen,    setAssignMenuOpen]     = useState(false);
  const [examinerSelects,   setExaminerSelects]    = useState({}); // projectId -> selected userId
  const [savingGuide,       setSavingGuide]        = useState({});
  const [savingExaminer,    setSavingExaminer]     = useState({});
  const [removingExaminer,  setRemovingExaminer]   = useState({});
  const assignBtnRef  = useRef(null);

  // manage (delete) mode
  const [editMode,          setEditMode]           = useState(false);
  const [deleteProjTarget,  setDeleteProjTarget]   = useState(null);
  const [deletingProj,      setDeletingProj]       = useState(false);

  // Excel upload
  const [uploading,   setUploading]   = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const uploadInputRef = useRef(null);

  // Add Team modal
  const [addTeamModal,  setAddTeamModal]  = useState(false);
  const [addTeamForm,   setAddTeamForm]   = useState({
    team_number: '', title: '', github: '',
    students: STUDENT_SLOTS.map(() => ({ usn: '', name: '' })),
  });
  const [addTeamSaving, setAddTeamSaving] = useState(false);
  const [addTeamErr,    setAddTeamErr]    = useState('');

  // Reviews
  const [revModal,      setRevModal]      = useState(false);
  const [revEdit,       setRevEdit]       = useState(null);
  const [revForm,       setRevForm]       = useState({ title: '', date: '', description: '', document_url: '' });
  const [revSaving,     setRevSaving]     = useState(false);
  const [revErr,        setRevErr]        = useState('');
  const [deleteRevTarget, setDeleteRevTarget] = useState(null);
  const [deletingRev,   setDeletingRev]   = useState(false);

  // ── Close assign dropdown on outside click ────────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (assignBtnRef.current && !assignBtnRef.current.contains(e.target)) {
        setAssignMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setError('');
    try {
      const [ps, coordCheck] = await Promise.all([
        getProjects(courseId),
        isAdminLevel ? Promise.resolve({ is_coordinator: true }) : isCourseCoordinator(courseId),
      ]);
      setProjects(ps || []);
      const coord = coordCheck.is_coordinator;
      setIsCoordinator(coord);

      if (coord) {
        const ts = await getTeachers();
        setTeachers(ts || []);
      }

      if (isTeacher) {
        const [gt, et] = await Promise.all([
          getMyGuideTeams(courseId),
          getMyExamTeams(courseId),
        ]);
        setGuideTeams(gt || []);
        setExamTeams(et || []);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    try {
      const r = await getReviews(courseId);
      setReviews(r || []);
    } catch {
      // non-critical
    }
  }, [courseId, isAdminLevel, isTeacher]);

  useEffect(() => { load(); }, [load]);

  // ── Assign guide ──────────────────────────────────────────────────────────
  async function handleAssignGuide(projectId, userId) {
    setSavingGuide(s => ({ ...s, [projectId]: true }));
    try {
      const updated = await assignGuide(projectId, userId || null);
      setProjects(ps => ps.map(p =>
        p.project_id === projectId
          ? { ...p, guide_id: updated.guide_id, guide_profile: teachers.find(t => t.id === updated.guide_id) || null }
          : p
      ));
    } catch (e) { setError(e.message); }
    finally { setSavingGuide(s => ({ ...s, [projectId]: false })); }
  }

  // ── Add examiner ──────────────────────────────────────────────────────────
  async function handleAddExaminer(projectId) {
    const uid = examinerSelects[projectId];
    if (!uid) return;
    setSavingExaminer(s => ({ ...s, [projectId]: true }));
    try {
      await addExaminer(projectId, uid);
      setExaminerSelects(s => ({ ...s, [projectId]: '' }));
      await load();
    } catch (e) { setError(e.message); }
    finally { setSavingExaminer(s => ({ ...s, [projectId]: false })); }
  }

  // ── Remove examiner ───────────────────────────────────────────────────────
  async function handleRemoveExaminer(projectId, userId) {
    const key = `${projectId}:${userId}`;
    setRemovingExaminer(s => ({ ...s, [key]: true }));
    try {
      await removeExaminer(projectId, userId);
      setProjects(ps => ps.map(p =>
        p.project_id === projectId
          ? { ...p, examiners: (p.examiners || []).filter(e => e.user_id !== userId) }
          : p
      ));
    } catch (e) { setError(e.message); }
    finally { setRemovingExaminer(s => ({ ...s, [key]: false })); }
  }

  // ── Delete project ────────────────────────────────────────────────────────
  async function handleDeleteProject() {
    setDeletingProj(true);
    try {
      await deleteProject(deleteProjTarget.project_id);
      setDeleteProjTarget(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setDeletingProj(false); }
  }

  // ── Excel upload ──────────────────────────────────────────────────────────
  async function handleExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null); setError('');
    try {
      const res = await uploadCourseExcel(courseId, file);
      setUploadResult(res);
      await load();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  // ── Add Team ──────────────────────────────────────────────────────────────
  async function handleAddTeam(e) {
    e.preventDefault();
    setAddTeamSaving(true); setAddTeamErr('');
    try {
      const students = addTeamForm.students.filter(s => s.usn.trim() && s.name.trim());
      const payload = {
        title: addTeamForm.title.trim(),
        github: addTeamForm.github.trim() || undefined,
        team_number: addTeamForm.team_number ? parseInt(addTeamForm.team_number) : undefined,
        students,
      };
      const newTeam = await createTeam(courseId, payload);
      setProjects(ps => [...ps, newTeam].sort((a, b) => {
        if (a.team_number == null && b.team_number == null) return 0;
        if (a.team_number == null) return 1;
        if (b.team_number == null) return -1;
        return a.team_number - b.team_number;
      }));
      setAddTeamModal(false);
      setAddTeamForm({ team_number: '', title: '', github: '', students: STUDENT_SLOTS.map(() => ({ usn: '', name: '' })) });
    } catch (e) { setAddTeamErr(e.message); }
    finally { setAddTeamSaving(false); }
  }

  function updateStudent(idx, field, val) {
    setAddTeamForm(f => {
      const s = [...f.students];
      s[idx] = { ...s[idx], [field]: val };
      return { ...f, students: s };
    });
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  function openNewReview() {
    setRevEdit(null);
    setRevForm({ title: '', date: '', description: '', document_url: '' });
    setRevErr('');
    setRevModal(true);
  }
  function openEditReview(rev) {
    setRevEdit(rev);
    setRevForm({ title: rev.title || '', date: rev.date ? rev.date.slice(0, 10) : '', description: rev.description || '', document_url: rev.document_url || '' });
    setRevErr('');
    setRevModal(true);
  }
  async function handleSaveReview(e) {
    e.preventDefault();
    setRevSaving(true); setRevErr('');
    try {
      const payload = { title: revForm.title, date: revForm.date, description: revForm.description || null, document_url: revForm.document_url || null };
      if (revEdit) await updateReview(revEdit.review_id, payload);
      else await createReview(courseId, payload);
      setRevModal(false);
      await load();
    } catch (e) { setRevErr(e.message); }
    finally { setRevSaving(false); }
  }
  async function handleDeleteReview() {
    setDeletingRev(true);
    try { await deleteReview(deleteRevTarget.review_id); setDeleteRevTarget(null); await load(); }
    catch (e) { setError(e.message); }
    finally { setDeletingRev(false); }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function enterAssignMode(mode) {
    setAssignMode(mode);
    setAssignMenuOpen(false);
    setEditMode(false);
  }

  function exitAssignMode() {
    setAssignMode(null);
    setExaminerSelects({});
  }

  function renderProjectCard(p) {
    const guideName = p.guide_profile?.name || p.guide_profile?.email || p.guide || null;
    const teamLabel = p.team_number != null ? `Team ${p.team_number}` : null;

    return (
      <div
        key={p.project_id}
        className="brutal-card"
        style={{ cursor: assignMode ? 'default' : 'pointer' }}
        onClick={() => { if (!assignMode) navigate(`/projects/${p.project_id}`); }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            {teamLabel && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent)', marginBottom: 4, fontWeight: 700 }}>
                {teamLabel}
              </div>
            )}
            <div className="card-title">
              {p.title || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Untitled</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
            {p.students?.length > 0 && (
              <span className="badge">{p.students.length} members</span>
            )}
            {isCoordinator && editMode && (
              <button
                className="pill-btn danger"
                style={{ fontSize: '0.6rem', padding: '4px 10px' }}
                onClick={e => { e.stopPropagation(); setDeleteProjTarget(p); }}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {guideName && !assignMode && (
          <div className="card-meta" style={{ marginTop: 6, color: 'var(--accent)' }}>
            ◈ {guideName}
          </div>
        )}
        {p.examiners?.length > 0 && !assignMode && (
          <div className="card-meta" style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            ✦ {p.examiners.map(ex => ex.name || ex.email).join(' · ')}
          </div>
        )}
        {p.github && !assignMode && (
          <div className="card-meta" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⎆ {p.github}
          </div>
        )}

        {/* Assign guide mode */}
        {assignMode === 'guide' && isCoordinator && (
          <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
            <label className="field-label" style={{ marginBottom: 4 }}>Guide</label>
            <select
              className="text-input"
              value={p.guide_id || ''}
              disabled={savingGuide[p.project_id]}
              onChange={e => handleAssignGuide(p.project_id, e.target.value)}
              style={{ fontSize: '0.85rem' }}
            >
              <option value="">— Unassigned —</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name || t.email}</option>
              ))}
            </select>
            {savingGuide[p.project_id] && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Saving…</div>
            )}
          </div>
        )}

        {/* Assign examiner mode */}
        {assignMode === 'examiner' && isCoordinator && (
          <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
            <label className="field-label" style={{ marginBottom: 6 }}>
              Examiners ({p.examiners?.length || 0}/2)
            </label>
            {(p.examiners?.length || 0) < 2 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  className="text-input"
                  style={{ flex: 1, fontSize: '0.85rem' }}
                  value={examinerSelects[p.project_id] || ''}
                  onChange={e => setExaminerSelects(s => ({ ...s, [p.project_id]: e.target.value }))}
                >
                  <option value="">Select teacher…</option>
                  {teachers
                    .filter(t => !p.examiners?.find(ex => ex.user_id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name || t.email}</option>
                    ))}
                </select>
                <button
                  className="pill-btn"
                  style={{ fontSize: '0.75rem', padding: '6px 14px', flexShrink: 0 }}
                  disabled={!examinerSelects[p.project_id] || savingExaminer[p.project_id]}
                  onClick={() => handleAddExaminer(p.project_id)}
                >
                  {savingExaminer[p.project_id] ? '…' : 'Add'}
                </button>
              </div>
            )}
            {p.examiners?.map(ex => {
              const key = `${p.project_id}:${ex.user_id}`;
              return (
                <div key={ex.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--accent-soft)' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{ex.name || ex.email}</span>
                  <button
                    className="pill-btn danger"
                    style={{ fontSize: '0.6rem', padding: '2px 8px' }}
                    disabled={removingExaminer[key]}
                    onClick={() => handleRemoveExaminer(p.project_id, ex.user_id)}
                  >
                    {removingExaminer[key] ? '…' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!assignMode && <div className="card-chevron">→</div>}
      </div>
    );
  }

  function renderTeacherTabs() {
    const tabs = [
      { key: 'guide', label: 'My Guide Teams', count: guideTeams.length },
      { key: 'exam',  label: 'My Examiner Teams', count: examTeams.length },
    ];
    const displayed = tab === 'guide' ? guideTeams : examTeams;
    return (
      <>
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--accent-soft)', marginBottom: 24 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 20px', fontFamily: 'var(--font-display)',
                fontSize: '0.85rem', fontWeight: 700,
                color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: tab === t.key ? '3px solid var(--accent)' : '3px solid transparent',
                marginBottom: -2,
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span className="badge" style={{ marginLeft: 8, fontSize: '0.6rem' }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
        {displayed.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">□</span>
            <span>No teams assigned to you yet</span>
          </div>
        ) : (
          <div className="cards-grid">{displayed.map(renderProjectCard)}</div>
        )}
      </>
    );
  }

  if (loading) return <Spinner large center />;

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/batches">Batches</Link>
          {batchName && <><span className="sep">›</span><span>{batchName}</span></>}
          {semLabel  && <><span className="sep">›</span><span>{semLabel}</span></>}
          <span className="sep">›</span>
          <span>{courseName}</span>
        </div>
        <div className="page-header-row">
          <h2>TEAMS</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

            {/* Coordinator controls */}
            {isCoordinator && !assignMode && coordTab === 'all' && (
              <>
                <button
                  className="pill-btn outline"
                  onClick={() => {
                    fetch(courseTemplateUrl(courseId), { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })
                      .then(r => r.blob()).then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = 'course_teams_template.xlsx'; a.click();
                      });
                  }}
                >
                  ↓ Template
                </button>

                <button className="pill-btn outline" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : '↑ Upload Excel'}
                </button>
                <input ref={uploadInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleExcelUpload} />

                <button className="pill-btn outline" onClick={() => setAddTeamModal(true)}>
                  + Add Team
                </button>

                {/* Assign dropdown */}
                <div style={{ position: 'relative' }} ref={assignBtnRef}>
                  <button
                    className="pill-btn outline"
                    onClick={() => setAssignMenuOpen(o => !o)}
                  >
                    Assign ▾
                  </button>
                  {assignMenuOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
                      background: 'var(--surface)', border: '2px solid var(--accent)',
                      boxShadow: '4px 4px 0 var(--accent)', borderRadius: 4, minWidth: 160,
                    }}>
                      {['guide', 'examiner'].map(mode => (
                        <button
                          key={mode}
                          onClick={() => enterAssignMode(mode)}
                          style={{
                            display: 'block', width: '100%', padding: '10px 16px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left', fontFamily: 'var(--font-display)',
                            fontSize: '0.85rem', fontWeight: 700,
                            color: 'var(--text)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          {mode === 'guide' ? 'Assign Guide' : 'Assign Examiner'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  className={`pill-btn outline`}
                  style={editMode ? { background: '#c0392b', borderColor: '#c0392b', color: '#fff' } : {}}
                  onClick={() => setEditMode(m => !m)}
                >
                  {editMode ? 'Done' : 'Manage'}
                </button>
              </>
            )}

            {/* Assign mode active — Done button */}
            {assignMode && (
              <button
                className="pill-btn"
                style={{ background: '#c0392b', borderColor: '#c0392b' }}
                onClick={exitAssignMode}
              >
                Done
              </button>
            )}
          </div>
        </div>

        {/* Assign mode label */}
        {assignMode && (
          <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700 }}>
            ● {assignMode === 'guide' ? 'ASSIGN GUIDE MODE — select a guide for each team below' : 'ASSIGN EXAMINER MODE — add/remove examiners for each team below'}
          </div>
        )}

        {/* Upload result */}
        {uploadResult && (
          <div className="alert" style={{ marginTop: 8, borderColor: '#22c55e', color: '#22c55e', fontSize: '0.8rem' }}>
            ✓ {uploadResult.teams_created} teams created, {uploadResult.teams_updated} updated, {uploadResult.students_inserted} students imported.
            <button style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }} onClick={() => setUploadResult(null)}>✕</button>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}


      {/* Coordinator tabbed view */}
      {isCoordinator && (
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--accent-soft)', marginBottom: 24 }}>
            {[
              { key: 'all',   label: 'All Teams',         count: projects.length },
              { key: 'guide', label: 'My Guide Teams',    count: guideTeams.length },
              { key: 'exam',  label: 'My Examiner Teams', count: examTeams.length },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => { setCoordTab(t.key); if (t.key !== 'all') { setAssignMode(null); setEditMode(false); } }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 20px', fontFamily: 'var(--font-display)',
                  fontSize: '0.85rem', fontWeight: 700,
                  color: coordTab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: coordTab === t.key ? '3px solid var(--accent)' : '3px solid transparent',
                  marginBottom: -2,
                }}
              >
                {t.label}
                {t.count > 0 && <span className="badge" style={{ marginLeft: 8, fontSize: '0.6rem' }}>{t.count}</span>}
              </button>
            ))}
          </div>

          {coordTab === 'all' && (
            projects.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">□</span>
                <span>No teams yet — upload an Excel file or add a team above</span>
              </div>
            ) : (
              <div className="cards-grid">{projects.map(renderProjectCard)}</div>
            )
          )}

          {coordTab === 'guide' && (
            guideTeams.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">□</span>
                <span>No teams assigned to you as guide</span>
              </div>
            ) : (
              <div className="cards-grid">{guideTeams.map(renderProjectCard)}</div>
            )
          )}

          {coordTab === 'exam' && (
            examTeams.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">□</span>
                <span>No teams assigned to you as examiner</span>
              </div>
            ) : (
              <div className="cards-grid">{examTeams.map(renderProjectCard)}</div>
            )
          )}
        </div>
      )}

      {/* Teacher tab view — non-coordinator */}
      {!isCoordinator && isTeacher && (
        <div style={{ marginBottom: 48 }}>
          {renderTeacherTabs()}
        </div>
      )}

      {/* Student / guest view */}
      {!isTeacher && (
        projects.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">□</span>
            <span>No teams yet</span>
          </div>
        ) : (
          <div className="cards-grid" style={{ marginBottom: 48 }}>
            {projects.map(renderProjectCard)}
          </div>
        )
      )}

      {/* Reviews section */}
      <div style={{ borderTop: '2px solid var(--accent-soft)', paddingTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 4 }}>Scheduled</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>REVIEWS</h3>
          </div>
          {isCoordinator && (
            <button className="pill-btn outline" onClick={openNewReview}>+ Schedule Review</button>
          )}
        </div>
        {reviews.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <span className="empty-icon" style={{ fontSize: '1.8rem' }}>◷</span>
            <span>No reviews scheduled yet</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reviews.map(rev => (
              <div key={rev.review_id} className="brutal-card dark" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, width: 64, textAlign: 'center', background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 4, padding: '8px 4px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>
                    {new Date(rev.date).getDate()}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {new Date(rev.date).toLocaleString('default', { month: 'short' })} {new Date(rev.date).getFullYear()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{rev.title}</div>
                  {rev.description && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{rev.description}</div>}
                  {rev.document_url && (
                    <a href={rev.document_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent)' }}>
                      ⇱ Document
                    </a>
                  )}
                </div>
                {isCoordinator && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="pill-btn outline" style={{ fontSize: '0.6rem', padding: '4px 10px' }} onClick={() => openEditReview(rev)}>Edit</button>
                    <button className="pill-btn danger" style={{ fontSize: '0.6rem', padding: '4px 10px' }} onClick={() => setDeleteRevTarget(rev)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Evaluations + Docs links ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 28, marginTop: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(isCoordinator || isTeacher) && (
          <button
            className="pill-btn outline"
            onClick={() => navigate(`/courses/${courseId}/marks`, { state: { courseName, semLabel, batchName } })}
          >
            ◈ Marks Entry
          </button>
        )}
        <button
          className="pill-btn outline"
          onClick={() => navigate(`/courses/${courseId}/docs`, { state: { courseName, semLabel, batchName } })}
        >
          ◻ Course Docs
        </button>
      </div>

      {/* ── Modals ── */}

      {/* Delete project */}
      <Modal open={!!deleteProjTarget} onClose={() => setDeleteProjTarget(null)} title="Delete Team">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
          Permanently delete <strong style={{ color: 'var(--text)' }}>{deleteProjTarget?.title || 'this team'}</strong> and all student records?
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>This cannot be undone.</p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteProjTarget(null)} disabled={deletingProj}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDeleteProject} disabled={deletingProj}>{deletingProj ? 'Deleting…' : 'Yes, Delete'}</button>
        </div>
      </Modal>

      {/* Add Team */}
      <Modal open={addTeamModal} onClose={() => setAddTeamModal(false)} title="Add Team">
        <form onSubmit={handleAddTeam}>
          {addTeamErr && <div className="alert error">{addTeamErr}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label className="field-label">Team No. (optional)</label>
              <input className="text-input" type="number" min="1" value={addTeamForm.team_number}
                onChange={e => setAddTeamForm(f => ({ ...f, team_number: e.target.value }))}
                placeholder="e.g. 1" />
            </div>
            <div>
              <label className="field-label">Project Title *</label>
              <input className="text-input" required value={addTeamForm.title}
                onChange={e => setAddTeamForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Smart Attendance" />
            </div>
          </div>
          <label className="field-label">GitHub URL (optional)</label>
          <input className="text-input" value={addTeamForm.github}
            onChange={e => setAddTeamForm(f => ({ ...f, github: e.target.value }))}
            placeholder="https://github.com/…" />

          <div style={{ marginTop: 16, marginBottom: 6, fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Students (up to 4)
          </div>
          {STUDENT_SLOTS.map(i => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 8, marginBottom: 8 }}>
              <input className="text-input" value={addTeamForm.students[i].usn}
                onChange={e => updateStudent(i, 'usn', e.target.value)}
                placeholder={`USN ${i + 1}`}
                style={{ fontSize: '0.85rem' }} />
              <input className="text-input" value={addTeamForm.students[i].name}
                onChange={e => updateStudent(i, 'name', e.target.value)}
                placeholder={`Name ${i + 1}`}
                style={{ fontSize: '0.85rem' }} />
            </div>
          ))}

          <div className="modal-actions">
            <button type="button" className="pill-btn outline" onClick={() => setAddTeamModal(false)}>Cancel</button>
            <button type="submit" className="pill-btn" disabled={addTeamSaving}>{addTeamSaving ? 'Creating…' : 'Create Team'}</button>
          </div>
        </form>
      </Modal>

      {/* Delete review */}
      <Modal open={!!deleteRevTarget} onClose={() => setDeleteRevTarget(null)} title="Delete Review">
        <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>Delete review <strong style={{ color: 'var(--text)' }}>{deleteRevTarget?.title}</strong>?</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>This cannot be undone.</p>
        <div className="modal-actions">
          <button className="pill-btn outline" onClick={() => setDeleteRevTarget(null)} disabled={deletingRev}>Cancel</button>
          <button className="pill-btn danger" onClick={handleDeleteReview} disabled={deletingRev}>{deletingRev ? 'Deleting…' : 'Yes, Delete'}</button>
        </div>
      </Modal>

      {/* Review modal */}
      <Modal open={revModal} onClose={() => setRevModal(false)} title={revEdit ? 'Edit Review' : 'Schedule Review'}>
        <form onSubmit={handleSaveReview}>
          {revErr && <div className="alert error">{revErr}</div>}
          <label className="field-label">Title</label>
          <input className="text-input" value={revForm.title} onChange={e => setRevForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Internal Review 1" required />
          <label className="field-label">Date</label>
          <input className="text-input" type="date" value={revForm.date} onChange={e => setRevForm(f => ({ ...f, date: e.target.value }))} required />
          <label className="field-label">Description (optional)</label>
          <textarea className="text-input" value={revForm.description} onChange={e => setRevForm(f => ({ ...f, description: e.target.value }))} rows={3} style={{ resize: 'vertical' }} />
          <label className="field-label">Document URL (optional)</label>
          <input className="text-input" value={revForm.document_url} onChange={e => setRevForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://drive.google.com/…" />
          <div className="modal-actions">
            <button type="button" className="pill-btn outline" onClick={() => setRevModal(false)}>Cancel</button>
            <button type="submit" className="pill-btn" disabled={revSaving}>{revSaving ? 'Saving…' : revEdit ? 'Update' : 'Schedule'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
