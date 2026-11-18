// Auth state: the JWT lives in localStorage, the user profile in React state.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, TOKEN_KEY } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));

  const applyUser = useCallback((u) => {
    setUser(u);
    // The farmer's saved language wins over the browser default once they are logged in.
    if (u?.preferredLanguage && u.preferredLanguage !== i18n.language) i18n.changeLanguage(u.preferredLanguage);
  }, [i18n]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  // Restore the session on page load.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api.get('/auth/me')
      .then((res) => applyUser(res.data.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [applyUser, logout]);

  useEffect(() => {
    window.addEventListener('auth:expired', logout);
    return () => window.removeEventListener('auth:expired', logout);
  }, [logout]);

  const saveSession = useCallback((data) => {
    localStorage.setItem(TOKEN_KEY, data.token);
    applyUser(data.user);
    return data.user;
  }, [applyUser]);

  const value = useMemo(() => ({
    user,
    loading,
    login: async (identifier, password) => saveSession((await api.post('/auth/login', { identifier, password })).data),
    register: async (payload) => saveSession((await api.post('/auth/register', payload)).data),
    updateProfile: async (patch) => {
      const res = await api.patch('/auth/me', patch);
      applyUser(res.data.user);
      return res.data.user;
    },
    logout,
  }), [user, loading, saveSession, applyUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
