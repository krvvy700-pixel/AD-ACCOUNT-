'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/context/AuthContext';
import {
  UserPlus, Shield, Eye, Code2, Trash2, Loader2, Lock, Check, X,
  ToggleLeft, ToggleRight, Pencil, KeyRound
} from 'lucide-react';

const ROLE_CONFIG = {
  admin: { label: 'Admin', color: 'bg-destructive/10 text-destructive', icon: Shield, desc: 'Full access + user management' },
  developer: { label: 'Developer', color: 'bg-primary/10 text-primary', icon: Code2, desc: 'Full access, no user management' },
  viewer: { label: 'Viewer', color: 'bg-muted text-muted-foreground', icon: Eye, desc: 'View-only access' },
};

export default function UserManagementPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [resetPasswordId, setResetPasswordId] = useState(null);

  // Create form
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Reset password form
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Action loading
  const [actionLoading, setActionLoading] = useState({});

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    if (newPassword.length < 8) {
      setCreateError('Password must be at least 8 characters');
      return;
    }
    setCreateLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || newUsername,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create user');
      } else {
        setNewUsername(''); setNewDisplayName(''); setNewPassword(''); setNewRole('viewer');
        setShowCreateForm(false);
        fetchUsers();
      }
    } catch {
      setCreateError('Network error');
    }
    setCreateLoading(false);
  };

  const handleToggleActive = async (user) => {
    setActionLoading(l => ({ ...l, [user.id]: 'toggle' }));
    try {
      await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive: !user.is_active }),
      });
      fetchUsers();
    } catch {}
    setActionLoading(l => ({ ...l, [user.id]: null }));
  };

  const handleRoleChange = async (user, newRole) => {
    setActionLoading(l => ({ ...l, [user.id]: 'role' }));
    try {
      await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, role: newRole }),
      });
      setEditingId(null);
      fetchUsers();
    } catch {}
    setActionLoading(l => ({ ...l, [user.id]: null }));
  };

  const handleResetPassword = async (userId) => {
    if (resetPassword.length < 8) return;
    setResetLoading(true);
    try {
      await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, password: resetPassword }),
      });
      setResetPasswordId(null);
      setResetPassword('');
    } catch {}
    setResetLoading(false);
  };

  const handleDelete = async (user) => {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    setActionLoading(l => ({ ...l, [user.id]: 'delete' }));
    try {
      await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id }),
      });
      fetchUsers();
    } catch {}
    setActionLoading(l => ({ ...l, [user.id]: null }));
  };

  if (!isAdmin) {
    return (
      <AppShell title="User Management">
        <div className="bg-card rounded-xl border border-border shadow-card p-16 text-center">
          <Shield size={40} className="mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Admin Access Required</h3>
          <p className="text-sm text-muted-foreground">Only administrators can manage users.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="User Management">
      {/* Role Legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={key} className="bg-card rounded-xl border border-border shadow-card p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg ${cfg.color}`}><Icon size={16} /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">{cfg.label}</p>
                <p className="text-xs text-muted-foreground">{cfg.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create User */}
      <div className="mb-6">
        {!showCreateForm ? (
          <button onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
            <UserPlus size={16} /> Add User
          </button>
        ) : (
          <div className="bg-card rounded-xl border border-border shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><UserPlus size={14} /> Create New User</h3>
              <button onClick={() => { setShowCreateForm(false); setCreateError(''); }} className="p-1 rounded hover:bg-muted"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              {createError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  <Lock size={12} /> {createError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Username *</label>
                  <input value={newUsername} onChange={e => setNewUsername(e.target.value)} required
                    placeholder="e.g. john_doe" autoComplete="off"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Display Name</label>
                  <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)}
                    placeholder="e.g. John Doe" autoComplete="off"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Password * <span className="text-muted-foreground font-normal">(min 8 chars)</span></label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required
                    minLength={8} autoComplete="new-password"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Role *</label>
                  <div className="flex items-center gap-2">
                    {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                      <button key={key} type="button" onClick={() => setNewRole(key)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                          newRole === key ? `${cfg.color} border-current` : 'border-border text-muted-foreground hover:text-foreground'
                        }`}>
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={createLoading || !newUsername || !newPassword}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50">
                  {createLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Create User
                </button>
                <button type="button" onClick={() => { setShowCreateForm(false); setCreateError(''); }}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Users ({users.length})</h3>
        </div>
        {loading ? (
          <div className="text-center py-12">
            <Loader2 size={20} className="animate-spin text-primary mx-auto" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No users created yet. The env admin ({process.env.NEXT_PUBLIC_ADMIN_HINT || 'ADMIN_USERNAME'}) still works.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  {['Username', 'Display Name', 'Role', 'Status', 'Last Login', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const roleCfg = ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer;
                  const RoleIcon = roleCfg.icon;
                  return (
                    <tr key={user.id} className="border-b border-border-soft hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground font-mono">{user.username}</td>
                      <td className="px-4 py-3 text-foreground">{user.display_name || '—'}</td>
                      <td className="px-4 py-3">
                        {editingId === user.id ? (
                          <div className="flex items-center gap-1">
                            {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                              <button key={key} onClick={() => handleRoleChange(user, key)}
                                disabled={!!actionLoading[user.id]}
                                className={`px-2 py-1 text-[10px] font-semibold rounded-md border transition-all ${
                                  user.role === key ? `${cfg.color} border-current` : 'border-border text-muted-foreground hover:text-foreground'
                                }`}>
                                {cfg.label}
                              </button>
                            ))}
                            <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-muted ml-1"><X size={12} /></button>
                          </div>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${roleCfg.color}`}>
                            <RoleIcon size={10} /> {roleCfg.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleToggleActive(user)} disabled={!!actionLoading[user.id]}
                          className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${user.is_active ? 'text-success hover:text-success/80' : 'text-muted-foreground hover:text-foreground'}`}>
                          {actionLoading[user.id] === 'toggle'
                            ? <Loader2 size={14} className="animate-spin" />
                            : user.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          {user.is_active ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingId(editingId === user.id ? null : user.id)}
                            className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title="Change Role">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => { setResetPasswordId(resetPasswordId === user.id ? null : user.id); setResetPassword(''); }}
                            className="p-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors" title="Reset Password">
                            <KeyRound size={12} />
                          </button>
                          <button onClick={() => handleDelete(user)} disabled={!!actionLoading[user.id]}
                            className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50" title="Delete">
                            {actionLoading[user.id] === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                        {/* Password Reset inline */}
                        {resetPasswordId === user.id && (
                          <div className="flex items-center gap-2 mt-2">
                            <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)}
                              placeholder="New password (min 8)" autoComplete="new-password"
                              className="px-2 py-1 text-xs border border-border rounded bg-surface text-foreground w-40 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                            <button onClick={() => handleResetPassword(user.id)}
                              disabled={resetLoading || resetPassword.length < 8}
                              className="px-2 py-1 text-xs font-medium bg-warning text-warning-foreground rounded disabled:opacity-50">
                              {resetLoading ? <Loader2 size={10} className="animate-spin" /> : 'Reset'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
