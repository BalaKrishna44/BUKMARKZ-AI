'use client';
import { useEffect } from 'react';
export function PWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw-push.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return <>{children}</>;
}
