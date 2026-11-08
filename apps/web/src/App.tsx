import { healthResponseSchema } from '@se/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

async function fetchHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}

/** Временный экран каркаса: показывает, что клиент видит сервер, базу и WebSocket. */
export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 5000 });
  const [ws, setWs] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => setWs('open');
    socket.onclose = () => setWs('closed');
    return () => socket.close();
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '48px auto', padding: '0 16px' }}>
      <h1>Совместные расходы</h1>
      <ul>
        <li>Сервер: {health.isPending ? '…' : health.isError ? 'недоступен' : health.data.status}</li>
        <li>База: {health.data?.db ?? '…'}</li>
        <li>WebSocket: {ws}</li>
      </ul>
    </main>
  );
}
