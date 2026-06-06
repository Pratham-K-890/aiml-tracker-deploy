import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { getDocs, uploadDoc, deleteDoc, isCourseCoordinator } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const EXT_ICON = {
  pdf:  { label: 'PDF',  color: '#e53e3e' },
  docx: { label: 'DOCX', color: '#3182ce' },
  doc:  { label: 'DOC',  color: '#3182ce' },
  xlsx: { label: 'XLSX', color: '#38a169' },
  xls:  { label: 'XLS',  color: '#38a169' },
  pptx: { label: 'PPTX', color: '#dd6b20' },
  ppt:  { label: 'PPT',  color: '#dd6b20' },
  png:  { label: 'PNG',  color: '#805ad5' },
  jpg:  { label: 'JPG',  color: '#805ad5' },
  jpeg: { label: 'JPG',  color: '#805ad5' },
};

function fileExt(name = '') {
  return (name.split('.').pop() || '').toLowerCase();
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DocsPage() {
  const { courseId }  = useParams();
  const { state }     = useLocation();
  const { role }      = useAuth();

  const courseName = state?.courseName || 'Course';
  const semLabel   = state?.semLabel   || '';
  const batchName  = state?.batchName  || '';

  const isAdminLevel = ['hod', 'admin'].includes(role);
  const [isCoordinator, setIsCoordinator] = useState(isAdminLevel);
  const [docs,    setDocs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState('');
  const [deletingId,  setDeletingId]  = useState('');
  const [dragOver,    setDragOver]    = useState(false);

  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [coordCheck, docs] = await Promise.all([
        isAdminLevel ? Promise.resolve({ is_coordinator: true }) : isCourseCoordinator(courseId),
        getDocs(courseId),
      ]);
      setIsCoordinator(coordCheck.is_coordinator);
      setDocs(docs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [courseId, isAdminLevel]);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(files) {
    if (!files?.length) return;
    setUploadErr('');
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadDoc(courseId, file);
      }
      await load();
    } catch (e) {
      setUploadErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    setDeletingId(doc.id);
    try {
      await deleteDoc(doc.id);
      setDocs(d => d.filter(x => x.id !== doc.id));
    } catch (e) { setError(e.message); }
    finally { setDeletingId(''); }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
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
          <Link to={`/courses/${courseId}/projects`} state={{ courseName, semLabel, batchName }}>
            {courseName}
          </Link>
          <span className="sep">›</span>
          <span>Docs</span>
        </div>
        <div className="page-header-row">
          <div>
            <div className="eyebrow" style={{ color: 'var(--accent)' }}>Course Resources</div>
            <h2>DOCUMENTS</h2>
          </div>
          {isCoordinator && (
            <button className="pill-btn outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : '↑ Upload'}
            </button>
          )}
        </div>
      </div>

      {error    && <div className="alert error">{error}</div>}
      {uploadErr && <div className="alert error">{uploadErr}</div>}

      {/* Upload drop zone — coordinator only */}
      {isCoordinator && (
        <>
          <div
            className="upload-zone"
            style={{
              marginBottom: 32,
              borderColor: dragOver ? 'var(--accent)' : undefined,
              background:  dragOver ? 'var(--accent-soft)' : undefined,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {uploading ? (
              <><Spinner /><p style={{ marginTop: 8 }}>Uploading…</p></>
            ) : (
              <>
                <div className="upload-icon">⬆</div>
                <p>Drag &amp; drop files here, or click to browse</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  PDF, Word, Excel, PowerPoint, images · max 20 MB each
                </p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
          />
        </>
      )}

      {/* Document list */}
      {docs.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">◻</span>
          <span>No documents uploaded yet{isCoordinator ? ' — upload the first one above' : ''}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(doc => {
            const ext  = fileExt(doc.name);
            const icon = EXT_ICON[ext] || { label: ext.toUpperCase() || 'FILE', color: 'var(--text-muted)' };
            return (
              <div
                key={doc.id}
                className="brutal-card"
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}
              >
                {/* Type badge */}
                <div style={{
                  flexShrink: 0, width: 44, textAlign: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: '0.58rem', fontWeight: 700,
                  color: '#fff', background: icon.color,
                  padding: '4px 2px', borderRadius: 4,
                }}>
                  {icon.label}
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {doc.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {[fmtSize(doc.file_size), fmtDate(doc.created_at), doc.uploaded_by_name && `by ${doc.uploaded_by_name}`]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="pill-btn outline"
                    style={{ fontSize: '0.7rem', padding: '4px 12px', textDecoration: 'none' }}
                  >
                    ↓ Download
                  </a>
                  {isCoordinator && (
                    <button
                      className="pill-btn danger"
                      style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                      disabled={deletingId === doc.id}
                      onClick={() => handleDelete(doc)}
                    >
                      {deletingId === doc.id ? '…' : '✕'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
