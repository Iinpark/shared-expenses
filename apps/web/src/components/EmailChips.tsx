import { useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon.js';

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Поле «По почте» из M09: адреса превращаются в чипы по Enter, запятой, пробелу или уходу с поля. */
export function EmailChips({ id, value, onChange }: { id: string; value: string[]; onChange: (emails: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const parts = draft.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((p) => !looksLikeEmail(p));
    const good = parts.filter(looksLikeEmail).filter((p) => !value.includes(p));
    if (good.length) onChange([...value, ...good]);
    setDraft(bad.join(' '));
    setError(bad.length ? 'Похоже, в адресе опечатка' : null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <>
      <div className="chips">
        {value.map((email) => (
          <span key={email} className="chip">
            {email}
            <button type="button" aria-label={`Убрать ${email}`} onClick={() => onChange(value.filter((v) => v !== email))}>
              <Icon name="close" size={14} strokeWidth={2.2} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          placeholder={value.length ? '' : 'boris@example.com'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
