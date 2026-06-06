import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import {
  getEvalReviews, toggleEvalReviewLock,
  getMyGuideTeams, getMyExamTeams,
  getMyEvalMarks, submitEvalMarks,
  isCourseCoordinator, downloadMarksExcel, downloadCESheet,
  getEvalReviewSummary,
} from '../api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';

export default function MarksPage() {
  const { courseId }  = useParams();
  const { state }     = useLocation();
  const { role }      = useAuth();

  const courseName = state?.courseName || 'Course';
  const semLabel   = state?.semLabel   || '';
  const batchName  = state?.batchName  || '';

  const isAdminLevel = ['hod', 'admin'].includes(role);
  const isTeacher    = ['hod', 'admin', 'teacher'].includes(role);

  const [isCoordinator, setIsCoordinator] = useState(isAdminLevel);
  const [evalReviews,   setEvalReviews]   = useState([]);
  const [guideTeams,    setGuideTeams]    = useState([]);
  const [examTeams,     setExamTeams]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  const [activeReviewId, setActiveReviewId] = useState(null);
  const [activeTeamIdx,  setActiveTeamIdx]  = useState(0);
  const [marksForm,      setMarksForm]      = useState({});
  const [marksLoading,   setMarksLoading]   = useState(false);
  const [marksSaving,    setMarksSaving]    = useState(false);
  const [marksMsg,       setMarksMsg]       = useState(null);

  const [lockingReview, setLockingReview] = useState({});
  const [downloading,   setDownloading]   = useState(false);
  const [downloadingCE, setDownloadingCE] = useState(false);

  const [viewModal,   setViewModal]   = useState(null);
  const [viewData,    setViewData]    = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewProjIdx, setViewProjIdx] = useState(0);

  const tableRef = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [coordCheck, er, gt, et] = await Promise.all([
        isAdminLevel
          ? Promise.resolve({ is_coordinator: true })
          : isCourseCoordinator(courseId),
        getEvalReviews(courseId),
        isTeacher ? getMyGuideTeams(courseId) : Promise.resolve([]),
        isTeacher ? getMyExamTeams(courseId)  : Promise.resolve([]),
      ]);
      setIsCoordinator(coordCheck.is_coordinator);
      setEvalReviews(er || []);
      setGuideTeams(gt || []);
      setExamTeams(et || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [courseId, isAdminLevel, isTeacher]);

  useEffect(() => { load(); }, [load]);

  // Guide teams + exam-only teams merged — guides are automatically evaluators
  const allTeams = [
    ...guideTeams.map(t => ({ ...t, myRole: 'guide' })),
    ...examTeams
      .filter(t => !guideTeams.some(g => g.project_id === t.project_id))
      .map(t => ({ ...t, myRole: 'examiner' })),
  ];

  async function loadMarks(reviewId, projectId) {
    setMarksLoading(true);
    setMarksMsg(null);
    try {
      const rows = await getMyEvalMarks(reviewId, projectId);
      const form = {};
      for (const row of (rows || [])) {
        form[row.student_id] = {
          c1: row.c1 ?? '', c2: row.c2 ?? '', c3: row.c3 ?? '',
          c4: row.c4 ?? '', c5: row.c5 ?? '',
        };
      }
      setMarksForm(form);
    } catch {
      setMarksForm({});
    } finally {
      setMarksLoading(false);
    }
  }

  function toggleReview(rev) {
    if (activeReviewId === rev.id) { setActiveReviewId(null); return; }
    setActiveReviewId(rev.id);
    setActiveTeamIdx(0);
    setMarksForm({});
    setMarksMsg(null);
    if (allTeams.length > 0) loadMarks(rev.id, allTeams[0].project_id);
  }

  function selectTeam(idx, team) {
    if (idx === activeTeamIdx) return;
    setActiveTeamIdx(idx);
    setMarksForm({});
    setMarksMsg(null);
    if (activeReviewId) loadMarks(activeReviewId, team.project_id);
  }

  async function saveMarks(team, rev) {
    setMarksSaving(true); setMarksMsg(null);
    try {
      const nc = rev.criteria?.length || 0;
      const toInt = v => (v === '' || v == null) ? null : parseInt(v);
      const payload = team.students.map(s => {
        const m = marksForm[s.student_id] || {};
        return {
          student_id: s.student_id,
          c1: nc >= 1 ? toInt(m.c1) : null,
          c2: nc >= 2 ? toInt(m.c2) : null,
          c3: nc >= 3 ? toInt(m.c3) : null,
          c4: nc >= 4 ? toInt(m.c4) : null,
          c5: nc >= 5 ? toInt(m.c5) : null,
        };
      });
      await submitEvalMarks(rev.id, team.project_id, payload);
      setMarksMsg({ type: 'ok', text: 'Marks saved.' });
    } catch (e) {
      setMarksMsg({ type: 'err', text: e.message });
    } finally {
      setMarksSaving(false);
    }
  }

  async function handleToggleLock(rev) {
    setLockingReview(s => ({ ...s, [rev.id]: true }));
    try {
      await toggleEvalReviewLock(rev.id, !rev.is_locked);
      setEvalReviews(rs => rs.map(r => r.id === rev.id ? { ...r, is_locked: !rev.is_locked } : r));
      if (activeReviewId === rev.id && !rev.is_locked) setActiveReviewId(null);
    } catch (e) { setError(e.message); }
    finally { setLockingReview(s => ({ ...s, [rev.id]: false })); }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await downloadMarksExcel(courseId);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'marks_sheet.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setDownloading(false); }
  }

  async function handleDownloadCE() {
    setDownloadingCE(true);
    try {
      const blob = await downloadCESheet(courseId);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'CE_marks.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setDownloadingCE(false); }
  }

  async function openViewMarks(rev) {
    setViewModal(rev);
    setViewProjIdx(0);
    setViewData([]);
    setViewLoading(true);
    try {
      const data = await getEvalReviewSummary(rev.id);
      setViewData(data || []);
    } catch (e) { setError(e.message); setViewModal(null); }
    finally { setViewLoading(false); }
  }

  function handleKeyDown(e, rowIdx, colIdx, numRows, numCols) {
    const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'];
    if (!navKeys.includes(e.key)) return;
    let nr = rowIdx, nc = colIdx;
    switch (e.key) {
      case 'ArrowUp':    nr--; break;
      case 'ArrowDown':
      case 'Enter':      nr++; break;
      case 'ArrowLeft':  nc--; if (nc < 0) { nc = numCols - 1; nr--; } break;
      case 'ArrowRight': nc++; if (nc >= numCols) { nc = 0; nr++; } break;
      case 'Tab':
        if (e.shiftKey) { nc--; if (nc < 0) { nc = numCols - 1; nr--; } }
        else            { nc++; if (nc >= numCols) { nc = 0; nr++; } }
        break;
    }
    e.preventDefault();
    if (nr < 0 || nr >= numRows || nc < 0 || nc >= numCols) return;
    const target = tableRef.current?.querySelector(`[data-row="${nr}"][data-col="${nc}"]`);
    if (target) { target.focus(); target.select(); }
  }

  if (loading) return <Spinner large center />;

  const activeRev    = evalReviews.find(r => r.id === activeReviewId) || null;
  const selectedTeam = allTeams[activeTeamIdx] || null;

  const thSt = {
    padding: '8px 10px', fontWeight: 600, fontSize: '0.75rem',
    color: 'var(--text-2)', background: 'var(--bg-hover)',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };
  const tdSt = { padding: '8px 10px', borderTop: '1px solid var(--border)', verticalAlign: 'middle' };

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/batches">Batches</Link>
          {batchName && <><span className="sep">›</span><span>{batchName}</span></>}
          {semLabel  && <><span className="sep">›</span><span>{semLabel}</span></>}
          <span className="sep">›</span>
          <Link to={`/courses/${courseId}/projects`} state={{ courseName, semLabel, batchName }}>
            {courseName}
          </Link>
          <span className="sep">›</span>
          <span>Marks</span>
        </div>
        <div className="page-header-row">
          <div>
            <div className="eyebrow" style={{ color: 'var(--accent)' }}>Evaluation</div>
            <h2>MARKS ENTRY</h2>
          </div>
          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="pill-btn outline" onClick={handleDownload} disabled={downloading}>
                {downloading ? 'Downloading…' : '↓ Evaluation Sheets'}
              </button>
              <button className="pill-btn outline" onClick={handleDownloadCE} disabled={downloadingCE}>
                {downloadingCE ? 'Downloading…' : '↓ CE Marks Sheet'}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {isTeacher && allTeams.length === 0 && (
        <div className="alert" style={{ borderColor: 'var(--accent-soft)', color: 'var(--text-2)', fontSize: '0.85rem', marginBottom: 20 }}>
          You are not assigned as guide or examiner for any team in this course yet.
        </div>
      )}

      {evalReviews.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">□</span>
          <span>No evaluation reviews set up for this course</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {evalReviews.map(rev => {
            const isActive = activeReviewId === rev.id;
            const canEnter = isTeacher && !rev.is_locked && allTeams.length > 0;

            return (
              <div key={rev.id}>
                {/* ── Review header ── */}
                <div className="brutal-card" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  ...(isActive ? { borderColor: 'var(--accent)', boxShadow: '4px 4px 0 var(--accent)' } : {}),
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.03em', marginBottom: 3,
                      color: rev.is_locked ? 'var(--text-3)' : 'var(--green)',
                    }}>
                      {rev.is_locked ? '● Locked' : '● Open for entry'}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
                      Review {rev.review_number}
                      <span style={{ fontWeight: 400, fontSize: '0.82rem', color: 'var(--text-2)', marginLeft: 8 }}>
                        {rev.phase}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 2 }}>
                      {rev.criteria?.length} criteria · Max {rev.max_total} marks
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {isCoordinator && (
                      <button
                        className={`pill-btn ${rev.is_locked ? 'outline' : 'danger'}`}
                        style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                        disabled={lockingReview[rev.id]}
                        onClick={() => handleToggleLock(rev)}
                      >
                        {lockingReview[rev.id] ? '…' : rev.is_locked ? 'Unlock' : 'Lock'}
                      </button>
                    )}
                    {isCoordinator && (
                      <button
                        className="pill-btn outline"
                        style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                        onClick={() => openViewMarks(rev)}
                      >
                        View Marks
                      </button>
                    )}
                    {canEnter && (
                      <button
                        className={`pill-btn ${isActive ? '' : 'outline'}`}
                        style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                        onClick={() => toggleReview(rev)}
                      >
                        {isActive ? '▲ Close' : '▼ Enter Marks'}
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Marks entry panel ── */}
                {isActive && (
                  <div className="brutal-card" style={{
                    borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0,
                    background: 'var(--surface)',
                  }}>
                    {allTeams.length === 0 ? (
                      <div style={{ color: 'var(--text-3)', fontSize: '0.85rem', padding: '12px 0' }}>
                        No teams assigned to you.
                      </div>
                    ) : (
                      <>
                        {/* Team tabs */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                          {allTeams.map((t, i) => (
                            <button
                              key={t.project_id}
                              onClick={() => selectTeam(i, t)}
                              className={`pill-btn ${activeTeamIdx === i ? '' : 'outline'}`}
                              style={{ fontSize: '0.72rem', padding: '4px 12px' }}
                            >
                              {t.team_number != null ? `Team ${t.team_number}` : (t.title?.slice(0, 16) || 'Team')}
                              <span style={{
                                marginLeft: 6, fontSize: '0.62rem', fontWeight: 400,
                                color: t.myRole === 'guide' ? 'var(--accent)' : 'var(--teal)',
                              }}>
                                {t.myRole === 'guide' ? 'guide' : 'examiner'}
                              </span>
                            </button>
                          ))}
                        </div>

                        {marksLoading ? (
                          <div style={{ textAlign: 'center', padding: '20px 0' }}><Spinner /></div>
                        ) : selectedTeam && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
                                {selectedTeam.title}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                                {selectedTeam.students?.length || 0} students
                              </span>
                              <span style={{
                                fontSize: '0.68rem', padding: '2px 7px', borderRadius: 3, fontWeight: 500,
                                border: `1px solid ${selectedTeam.myRole === 'guide' ? 'var(--accent)' : 'var(--teal)'}`,
                                color: selectedTeam.myRole === 'guide' ? 'var(--accent)' : 'var(--teal)',
                              }}>
                                {selectedTeam.myRole === 'guide' ? 'Guide / Evaluator' : 'Examiner'}
                              </span>
                            </div>

                            {!selectedTeam.students?.length ? (
                              <div style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>No students in this team.</div>
                            ) : (
                              <div style={{ overflowX: 'auto' }} ref={tableRef}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ ...thSt, textAlign: 'left', minWidth: 110 }}>USN</th>
                                      <th style={{ ...thSt, textAlign: 'left', minWidth: 150 }}>Name</th>
                                      {(activeRev.criteria || []).map((c, i) => (
                                        <th key={i} style={{ ...thSt, textAlign: 'center', minWidth: 80 }}>
                                          {c.split(' ').slice(0, 2).join(' ')}
                                          <div style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>
                                            /{activeRev.max_each}
                                          </div>
                                        </th>
                                      ))}
                                      <th style={{ ...thSt, textAlign: 'center', minWidth: 66 }}>
                                        Total
                                        <div style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>
                                          /{activeRev.max_total}
                                        </div>
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedTeam.students.map((s, rowIdx) => {
                                      const nc    = activeRev.criteria?.length || 0;
                                      const total = Array.from({ length: nc }, (_, i) =>
                                        parseInt(marksForm[s.student_id]?.[`c${i + 1}`]) || 0
                                      ).reduce((a, b) => a + b, 0);
                                      return (
                                        <tr key={s.student_id}>
                                          <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{s.usn}</td>
                                          <td style={tdSt}>{s.name}</td>
                                          {Array.from({ length: nc }, (_, colIdx) => (
                                            <td key={colIdx} style={{ ...tdSt, textAlign: 'center', padding: '6px 8px' }}>
                                              <input
                                                type="number"
                                                min="0"
                                                max={activeRev.max_each}
                                                className="text-input"
                                                data-row={rowIdx}
                                                data-col={colIdx}
                                                style={{ width: 56, padding: '4px 6px', fontSize: '0.82rem', textAlign: 'center' }}
                                                value={marksForm[s.student_id]?.[`c${colIdx + 1}`] ?? ''}
                                                onChange={e => setMarksForm(f => ({
                                                  ...f,
                                                  [s.student_id]: { ...(f[s.student_id] || {}), [`c${colIdx + 1}`]: e.target.value },
                                                }))}
                                                onKeyDown={e => handleKeyDown(e, rowIdx, colIdx, selectedTeam.students.length, nc)}
                                                onFocus={e => e.target.select()}
                                              />
                                            </td>
                                          ))}
                                          <td style={{ ...tdSt, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                                            {total}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {marksMsg && (
                              <div style={{ marginTop: 12, fontSize: '0.82rem', fontWeight: 500, color: marksMsg.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>
                                {marksMsg.type === 'ok' ? '✓ ' : '✕ '}{marksMsg.text}
                              </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                              <button
                                className="pill-btn"
                                disabled={marksSaving || !selectedTeam.students?.length}
                                onClick={() => saveMarks(selectedTeam, activeRev)}
                              >
                                {marksSaving ? 'Saving…' : 'Save Marks'}
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* View marks summary — coordinator */}
      <Modal
        open={!!viewModal}
        onClose={() => setViewModal(null)}
        title={viewModal ? `Marks — Review ${viewModal.review_number}: ${viewModal.phase}` : ''}
        wide
      >
        {viewModal && (
          viewLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}><Spinner /></div>
          ) : viewData.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '32px 0', fontSize: '0.85rem' }}>
              No marks entered yet for this review.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {viewData.map((proj, i) => (
                  <button
                    key={proj.project_id}
                    className={`pill-btn ${viewProjIdx === i ? '' : 'outline'}`}
                    style={{ fontSize: '0.72rem', padding: '4px 10px' }}
                    onClick={() => setViewProjIdx(i)}
                  >
                    {proj.team_number != null ? `Team ${proj.team_number}` : (proj.title?.slice(0, 14) || 'Team')}
                  </button>
                ))}
              </div>

              {(() => {
                const proj = viewData[viewProjIdx];
                if (!proj) return null;

                const scorers = [];
                const seen    = new Set();
                for (const s of proj.students || []) {
                  for (const m of s.marks || []) {
                    const key = `${m.scorer_type}:${m.scorer_name}`;
                    if (!seen.has(key)) {
                      seen.add(key);
                      scorers.push({ key, name: m.scorer_name, type: m.scorer_type });
                    }
                  }
                }

                return (
                  <>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)', marginBottom: 12 }}>
                      {proj.title}
                      <span style={{ fontWeight: 400, color: 'var(--text-3)', fontSize: '0.78rem', marginLeft: 8 }}>
                        {proj.students?.length || 0} students
                      </span>
                    </div>
                    {scorers.length === 0 ? (
                      <div style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>No marks for this team yet.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr>
                              <th style={{ ...thSt, textAlign: 'left' }}>USN</th>
                              <th style={{ ...thSt, textAlign: 'left' }}>Name</th>
                              {scorers.map(sc => (
                                <th key={sc.key} style={{ ...thSt, textAlign: 'center', minWidth: 90 }}>
                                  {sc.name}
                                  <div style={{
                                    fontWeight: 400, fontSize: '0.68rem', textTransform: 'uppercase',
                                    color: sc.type === 'guide' ? 'var(--accent)' : 'var(--teal)',
                                  }}>
                                    {sc.type === 'guide' ? 'guide/eval' : 'examiner'}
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(proj.students || []).map(s => (
                              <tr key={s.student_id}>
                                <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{s.usn}</td>
                                <td style={tdSt}>{s.name}</td>
                                {scorers.map(sc => {
                                  const m = s.marks?.find(x => x.scorer_type === sc.type && x.scorer_name === sc.name);
                                  return (
                                    <td key={sc.key} style={{ ...tdSt, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: m ? 'var(--accent)' : 'var(--text-3)' }}>
                                      {m ? m.total : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="modal-actions" style={{ marginTop: 20 }}>
                      <button className="pill-btn outline" onClick={() => setViewModal(null)}>Close</button>
                    </div>
                  </>
                );
              })()}
            </>
          )
        )}
      </Modal>
    </>
  );
}
