'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { username, role, permissions }
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const role = user?.role || 'viewer';
  const permissions = user?.permissions || {
    canEdit: false,
    canManageUsers: false,
    canCreateRules: false,
    canPauseEnable: false,
  };

  return (
    <AuthContext.Provider value={{
      user,
      role,
      permissions,
      loading,
      isAdmin: role === 'admin',
      isDeveloper: role === 'developer',
      isViewer: role === 'viewer',
      canEdit: permissions.canEdit,
      canManageUsers: permissions.canManageUsers,
      canPauseEnable: permissions.canPauseEnable,
      canCreateRules: permissions.canCreateRules,
      refetchUser: fetchUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
