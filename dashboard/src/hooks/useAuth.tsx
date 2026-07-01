'use client';

import { useEffect, createContext, useContext, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getUserProfile, createUserProfile } from '@/lib/db';
import { useAppStore } from '@/store/appStore';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const setAppUser = useAppStore(s => s.setUser);
  const router = useRouter();
  const pathname = usePathname();

  // 1. Subscribe to auth state changes ONCE on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          let profile = await getUserProfile(firebaseUser.uid);
          if (!profile) {
            await createUserProfile(firebaseUser.uid, firebaseUser.email || '');
            profile = await getUserProfile(firebaseUser.uid);
          }
          setAppUser(profile);
          setUser(firebaseUser);
        } else {
          setAppUser(null);
          setUser(null);
        }
      } catch (err) {
        console.error("Auth state change error:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [setAppUser]);

  // 2. Separate routing checks from the auth listener subscription
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
