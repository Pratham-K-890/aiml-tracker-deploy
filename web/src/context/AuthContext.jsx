import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, clearToken, TRACKER, authHeaders } from '../api';
import { isLoggedIn } from '../auth';

const AuthContext = createContext({ role: '', email: '', userId: '', loading: true, refresh: () => {} });

export function AuthProvider({ children }) {
  const [role, setRole]       = useState('');
  const [email, setEmail]     = useState('');
  const [userId, setUserId]   = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isLoggedIn()) { setRole(''); setEmail(''); setUserId(''); setLoading(false); return; }
    try {
      const res = await fetch(`${TRACKER}/me`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRole(data.role || 'teacher');
      setEmail(data.email || '');
      setUserId(data.id || '');
      localStorage.setItem('user_role', data.role || 'teacher');
    } catch {
      // Fallback to cached value
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <AuthContext.Provider value={{ role, email, userId, loading, refresh, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
