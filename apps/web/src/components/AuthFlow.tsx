import type { Gender, Me } from '@se/shared';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api.js';
import { useMe, useSetMe } from '../lib/session.js';

type Step = 'email' | 'code' | 'profile';

/**
 * Вход в два шага без пароля (записка дизайнера): почта → код из письма.
 * При первом входе третий шаг — имя: без него человека нельзя показать в группе.
 */
export function AuthFlow({ submitLabel = 'Получить код', onDone }: { submitLabel?: string; onDone?: (me: Me) => void }) {
  const me = useMe().data;
  const setMe = useSetMe();
  const [step, setStep] = useState<Step>(me && !me.name ? 'profile' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await api('POST', '/api/auth/request-code', { email });
      setStep('code');
      setCode('');
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const user = await api<Me>('POST', '/api/auth/verify', { email, code });
      setMe(user);
      if (user.name) onDone?.(user);
      else setStep('profile');
    });
  };

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const user = await api<Me>('PATCH', '/api/me', { name, gender });
      setMe(user);
      onDone?.(user);
    });
  };

  if (step === 'email') {
    return (
      <form className="field" style={{ gap: 10 }} onSubmit={sendCode}>
        <label htmlFor="email" className="field__label--strong">
          Твоя почта
        </label>
        <input
          id="email"
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn--primary btn--main" disabled={busy || !email}>
          {submitLabel}
        </button>
        <p className="hint">Пришлём код из 6 цифр. Пароль не нужен. Уже есть аккаунт с этой почтой? Код просто войдёт в него.</p>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form className="field" style={{ gap: 10 }} onSubmit={verify}>
        <label htmlFor="code" className="field__label--strong">
          Код из письма на {email}
        </label>
        <input
          id="code"
          className="input input--code n"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn--primary btn--main" disabled={busy || code.length !== 6}>
          Войти
        </button>
        <p className="hint">
          Не пришло?{' '}
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={async () => {
              await sendCode();
              setResent(true);
            }}
          >
            {resent ? 'Отправили ещё раз' : 'Прислать ещё раз'}
          </button>{' '}
          ·{' '}
          <button type="button" className="link" onClick={() => setStep('email')}>
            Другая почта
          </button>
        </p>
        {import.meta.env.DEV && (
          <p className="hint-sm">
            Локально письма не уходят наружу: код лежит в Mailpit,{' '}
            <a className="link" href="http://localhost:8025" target="_blank" rel="noreferrer">
              localhost:8025
            </a>
          </p>
        )}
      </form>
    );
  }

  return (
    <form className="field" style={{ gap: 16 }} onSubmit={saveProfile}>
      <div className="field">
        <label htmlFor="name" className="field__label--strong">
          Как тебя зовут?
        </label>
        <input id="name" className="input" autoComplete="given-name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="hint-sm">Так тебя увидят в группе: «Аня заплатила за ужин».</p>
      </div>
      <div className="field">
        <span id="gender" className="field__label">
          Как писать о тебе
        </span>
        <div role="radiogroup" aria-labelledby="gender" className="segments">
          {(
            [
              ['m', 'изменил'],
              ['f', 'изменила'],
              [null, 'не важно'],
            ] as const
          ).map(([value, label]) => (
            <button key={label} type="button" role="radio" aria-checked={gender === value} onClick={() => setGender(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn--primary btn--main" disabled={busy || !name.trim()}>
        Готово
      </button>
    </form>
  );
}
