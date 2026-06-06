import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../auth';
import { getMe } from '../api';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate    = useNavigate();
  const { refresh } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      await refresh();
      const profile = await getMe();
      localStorage.setItem('user_role', profile.role);
      navigate(['admin', 'hod'].includes(profile.role) ? '/admin' : '/batches');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">

      {/* ── Left: decoration ── */}
      <div className="login-left">
        <div className="login-left-glow" />
        <div className="login-left-rings" aria-hidden="true" />
        <div className="login-left-content">
          <div className="login-left-eyebrow">Department · Project Tracker</div>
          <div className="login-wordmark">Project Tracker</div>
          <p className="login-left-sub">
            One place to manage every batch, course,<br />review, and team from start to submission.
          </p>
          <div className="login-features">
            <div className="login-feature">
              <span className="lf-icon">◈</span>
              <span>Batches, semesters &amp; course hierarchy</span>
            </div>
            <div className="login-feature">
              <span className="lf-icon">◷</span>
              <span>Schedule reviews with document links</span>
            </div>
            <div className="login-feature">
              <span className="lf-icon">⎆</span>
              <span>GitHub tracking &amp; team management</span>
            </div>
            <div className="login-feature">
              <span className="lf-icon lf-icon--teal">✦</span>
              <span>AI feedback on project progress</span>
            </div>
          </div>
        </div>
        <div className="login-bg-text" aria-hidden="true">PT</div>
      </div>

      {/* ── Right: form ── */}
      <div className="login-right">
        <div className="login-box">
          <div className="login-mark">PT</div>
          <h1>Sign in</h1>
          <p className="login-sub">Department Project Tracker</p>

          {error && <div className="alert error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label className="field-label">Email</label>
            <input
              className="text-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@college.edu"
              autoComplete="email"
              required
            />
            <label className="field-label">Password</label>
            <input
              className="text-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              style={{ marginBottom: 22 }}
            />
            <button
              className="pill-btn w-full"
              type="submit"
              disabled={loading}
              style={{ justifyContent: 'center', padding: '10px 14px', fontSize: '0.88rem' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="login-note">
            Accounts are managed by the admin.
          </p>
        </div>
      </div>

    </div>
  );
}
