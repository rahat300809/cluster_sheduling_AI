'use client';

import { useEffect, createContext, useContext, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useRouter, usePathname } from 'next/navigation';
import type { UserProfile } from '@/types';

// ── Local auth (no Firebase) ──────────────────────────────────────────────────
// Fake user profile used when logged in locally
function buildLocalUser(email: string): UserProfile {
  return {
    uid: 'local-user',
    email,
    displayName: email.split('@')[0],
    role: 'developer',
    createdAt: Date.now(),
  };
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const setAppUser = useAppStore(s => s.setUser);
  const router = useRouter();
  const pathname = usePathname();

  // 1. On mount, check localStorage for a local auth session
  useEffect(() => {
    try {
      const stored = localStorage.getItem('local_auth_user');
      if (stored) {
        const parsed = JSON.parse(stored) as { email: string };
        const profile = buildLocalUser(parsed.email);
        setAppUser(profile);
        setUser(profile);
      } else {
        setAppUser(null);
        setUser(null);
      }
    } catch {
      setAppUser(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setAppUser]);

  // 2. Route guard
  useEffect(() => {
    if (loading) return;

    if (user) {
      if (pathname === '/login' || pathname === '/login/') {
        router.push('/');
      }
    } else {
      if (pathname !== '/login' && pathname !== '/login/') {
        router.push('/login');
      }
    }
  }, [user, loading, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
