'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState('USD');
  const [rate, setRateState] = useState(83.5);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('currency') : null;
    if (saved === 'INR' || saved === 'USD') setCurrencyState(saved);
    const savedRate = typeof window !== 'undefined' ? localStorage.getItem('inrRate') : null;
    if (savedRate) setRateState(Number(savedRate));

    // Fetch live rate from server
    fetch('/api/settings/exchange-rate').then(r => r.json()).then(d => {
      if (d.rate) setRateState(d.rate);
    }).catch(() => {});
  }, []);

  const setCurrency = useCallback((c) => {
    setCurrencyState(c);
    localStorage.setItem('currency', c);
  }, []);

  const setRate = useCallback((r) => {
    setRateState(r);
    localStorage.setItem('inrRate', String(r));
  }, []);

  const formatMoney = useCallback((amount) => {
    if (amount == null) return '—';
    const converted = currency === 'INR' ? amount * rate : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted);
  }, [currency, rate]);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatMoney, rate, setRate }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
