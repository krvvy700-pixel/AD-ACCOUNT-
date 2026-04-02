'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AccountContext = createContext(null);

export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/meta/accounts');
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Selected account object (or null for "all")
  const selectedAccount = selectedAccountId === 'all'
    ? null
    : accounts.find(a => a.id === selectedAccountId) || null;

  // Query param string for API calls
  const accountQueryParam = selectedAccountId === 'all' ? '' : `&account=${selectedAccountId}`;

  return (
    <AccountContext.Provider value={{
      accounts,
      selectedAccountId,
      setSelectedAccountId,
      selectedAccount,
      accountQueryParam,
      loading,
      refetchAccounts: fetchAccounts,
    }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
