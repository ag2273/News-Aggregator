import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './api';

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const TOKEN_KEY = 'news_aggregator_auth_token';

export async function getStoredToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(TOKEN_KEY);
      }
    }
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(TOKEN_KEY);
    }
    return null;
  }
}

export async function setStoredToken(token: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TOKEN_KEY, token);
        return;
      }
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
  }
}

export async function removeStoredToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(TOKEN_KEY);
        return;
      }
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  }
}

export async function register(
  email: string,
  pass: string,
  name?: string,
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, name }),
  });
  const json = (await res.json()) as { data?: AuthResponse; error?: string };
  if (!res.ok || !json.data) {
    throw new Error(json.error ?? 'تعذّر إنشاء الحساب');
  }
  return json.data;
}

export async function login(email: string, pass: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  const json = (await res.json()) as { data?: AuthResponse; error?: string };
  if (!res.ok || !json.data) {
    throw new Error(json.error ?? 'بيانات الدخول غير صحيحة');
  }
  return json.data;
}

export async function getMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { data?: { user: User }; error?: string };
  if (!res.ok || !json.data) {
    throw new Error(json.error ?? 'انتهت صلاحية الجلسة');
  }
  return json.data.user;
}

export async function logout(token: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Best-effort network notification on logout
  }
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on app launch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await getStoredToken();
        if (saved && !cancelled) {
          const profile = await getMe(saved);
          if (!cancelled) {
            setToken(saved);
            setUser(profile);
          }
        }
      } catch {
        if (!cancelled) {
          await removeStoredToken();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, pass: string) => {
    const res = await login(email, pass);
    await setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (email: string, pass: string, name?: string) => {
    const res = await register(email, pass, name);
    await setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    if (token) {
      await logout(token);
    }
    await removeStoredToken();
    setToken(null);
    setUser(null);
  }, [token]);

  const value = useMemo<AuthContextType>(
    () => ({ user, token, loading, signIn, signUp, signOut }),
    [user, token, loading, signIn, signUp, signOut],
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}
