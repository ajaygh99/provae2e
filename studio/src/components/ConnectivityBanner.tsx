import { useEffect, useState } from 'react';

/** Announces browser connectivity changes without blocking local editing. */
export function ConnectivityBanner(): React.JSX.Element | null {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = (): void => setOnline(true);
    const disconnected = (): void => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);
  if (online) return null;
  return (
    <div className="connectivity-banner" role="status">
      Offline: local drafts remain available, but runs and refresh actions may fail until the Studio service reconnects.
    </div>
  );
}
