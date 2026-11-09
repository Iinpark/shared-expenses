import type { Me } from '@se/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { Avatar } from './Avatar.js';

/** Кнопка профиля в шапке. Пока в меню только выход. */
export function ProfileMenu({ me, compact }: { me: Me; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const name = me.name ?? me.email;

  const logout = async () => {
    await api('POST', '/api/auth/logout');
    qc.clear();
    void navigate('/login', { replace: true });
  };

  return (
    <div style={{ position: 'relative' }}>
      {compact ? (
        <button aria-label={`Профиль: ${name}`} className="avatar avatar--lg" style={{ cursor: 'pointer' }} onClick={() => {
            setOpen((v) => !v);
          }}
        >
          {name.charAt(0).toUpperCase()}
        </button>
      ) : (
        <button aria-label={`Профиль: ${name}`} className="profile-btn" onClick={() => {
            setOpen((v) => !v);
          }}
        >
          <Avatar name={name} />
          {name}
        </button>
      )}
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 220, padding: 8, zIndex: 20 }}>
          <p className="hint" style={{ padding: '6px 10px' }}>
            {me.email}
          </p>
          <button className="btn" style={{ width: '100%', border: 0, justifyContent: 'flex-start' }} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
