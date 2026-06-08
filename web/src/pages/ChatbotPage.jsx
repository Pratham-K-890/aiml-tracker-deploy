import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatFilter } from '../api';
import Spinner from '../components/Spinner';

const HINTS = [
  'Show ML projects from batch 2024-2028',
  'Projects guided by Dr. Smith in sem 5',
  'All projects with a GitHub link',
  'Python projects in sem 3',
];

export default function ChatbotPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Ask me anything about the projects — search by name, guide, student, or ask analytical questions like "which guide has the most projects".' },
  ]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const lastFilterRef = useRef(null);
  const bottomRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(query) {
    const q = (query || input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const data = await chatFilter(q, lastFilterRef.current);
      if (data.type === 'filter') lastFilterRef.current = data.filter;
      else lastFilterRef.current = null;
      setMessages(m => [...m, { role: 'ai', type: 'results', data }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'ai', text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <>
      <div className="page-header">
        <div className="eyebrow">AI Assistant</div>
        <h2>ASK AI</h2>
      </div>

      <div className="chat-layout">
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div className="chat-bubble user">{msg.text}</div>
              ) : msg.type === 'results' ? (
                <AIResultCard data={msg.data} onNavigate={navigate} />
              ) : (
                <div className="chat-bubble ai">{msg.text}</div>
              )}
            </div>
          ))}
          {loading && (
            <div className="chat-bubble ai">
              <Spinner />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Hint chips */}
        {messages.length <= 2 && !loading && (
          <div className="tag-list" style={{ marginBottom: 12 }}>
            {HINTS.map(h => (
              <button key={h} className="tag" style={{ cursor: 'pointer', background: 'var(--accent-soft)' }}
                onClick={() => send(h)}>
                {h}
              </button>
            ))}
          </div>
        )}

        <div className="chat-input-row">
          <input
            className="text-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. Show all ML projects from 2024 batch…"
            disabled={loading}
          />
          <button className="pill-btn" onClick={() => send()} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </>
  );
}

const FILTER_LABELS = {
  batch_name: 'Batch',
  sem_number: 'Semester',
  course_name: 'Course',
  title: 'Title',
  guide_name: 'Guide',
  keyword: 'Keyword',
};

function AIResultCard({ data, onNavigate }) {
  if (data.type === 'aggregate') {
    return (
      <div className="chat-bubble ai" style={{ maxWidth: '90%', width: '100%' }}>
        <div className="label-tag">AI Answer</div>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{data.answer}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Based on {data.total_projects} projects in the database.
        </div>
      </div>
    );
  }

  const { filter, projects, count, summary, rephrasing } = data;

  const filterTags = Object.entries(filter || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${FILTER_LABELS[k] || k}: ${v}`);

  return (
    <div className="chat-bubble ai" style={{ maxWidth: '90%', width: '100%' }}>
      <div className="label-tag">AI Filter Result</div>
      {filterTags.length > 0 && (
        <div className="tag-list" style={{ marginBottom: 10 }}>
          {filterTags.map(t => <span key={t} className="tag">{t}</span>)}
        </div>
      )}
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>
        {summary}
      </div>
      {count === 0 ? (
        <div>
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>No projects matched.</div>
          {rephrasing && (
            <div style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <strong>Try:</strong> {rephrasing}
            </div>
          )}
        </div>
      ) : (
        projects.map(p => (
          <button
            key={p.project_id}
            className="project-result-card"
            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0 }}
            onClick={() => onNavigate(`/projects/${p.project_id}`)}
          >
            <div>
              <div className="proj-title">{p.title || 'Untitled'}</div>
              <div className="proj-meta">
                {[
                  p.course?.course_name,
                  p.course?.semester ? `Sem ${p.course.semester.sem_number}` : null,
                  p.course?.semester?.batch?.batch_name,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span style={{ color: 'var(--accent)' }}>→</span>
          </button>
        ))
      )}
    </div>
  );
}
