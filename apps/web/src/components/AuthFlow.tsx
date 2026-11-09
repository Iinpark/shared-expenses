import type { Gender, Me } from '@se/shared';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
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

  const sendCode = (e?: SyntheticEvent) => {
    e?.preventDefault();
    return run(async () => {
      await api('POST', '/api/auth/request-code', { email });
      setStep('code');
      setCode('');
    });
  };

  const verify = (e: SyntheticEvent) => {
    e.preventDefault();
    return run(async () => {
      const user = await api<Me>('POST', '/api/auth/verify', { email, code });
      setMe(user);
      if (user.name) onDone?.(user);
      else setStep('profile');
    });
  };

  const saveProfile = (e: SyntheticEvent) => {
    e.preventDefault();
    return run(async () => {
      const user = await api<Me>('PATCH', '/api/me', { name, gender });
      setMe(user);
      onDone?.(user);
    });
  };

  if (step === 'email') {
    return (
      <EmailStep email={email} setEmail={setEmail} busy={busy} error={error} submitLabel={submitLabel} onSubmit={(e) => void sendCode(e)} />
    );
  }

  if (step === 'code') {
    return (
      <CodeStep
        email={email}
        code={code}
        setCode={setCode}
        busy={busy}
        error={error}
        resent={resent}
        onSubmit={(e) => void verify(e)}
        onResend={() =>
          void sendCode().then(() => {
            setResent(true);
          })
        }
        onOtherEmail={() => {
          setStep('email');
        }}
      />
    );
  }

  return <ProfileStep name={name} setName={setName} gender={gender} setGender={setGender} busy={busy} error={error} onSubmit={(e) => void saveProfile(e)} />;
}

type Submit = (e: SyntheticEvent) => void;

const ErrorText = ({ error }: { error: string | null }) => (error ? <p className="field-error">{error}</p> : null);

function EmailStep(p: { email: string; setEmail: (v: string) => void; busy: boolean; error: string | null; submitLabel: string; onSubmit: Submit }) {
  return (
    <form className="field" style={{ gap: 10 }} onSubmit={p.onSubmit}>
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
        value={p.email}
        onChange={(e) => {
          p.setEmail(e.target.value);
        }}
      />
      <ErrorText error={p.error} />
      <button className="btn btn--primary btn--main" disabled={p.busy || !p.email}>
        {p.submitLabel}
      </button>
      <p className="hint">Пришлём код из 6 цифр. Пароль не нужен. Уже есть аккаунт с этой почтой? Код просто войдёт в него.</p>
    </form>
  );
}

function CodeStep(p: {
  email: string;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  resent: boolean;
  onSubmit: Submit;
  onResend: () => void;
  onOtherEmail: () => void;
}) {
  return (
    <form className="field" style={{ gap: 10 }} onSubmit={p.onSubmit}>
      <label htmlFor="code" className="field__label--strong">
        Код из письма на {p.email}
      </label>
      <input
        id="code"
        className="input input--code n"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={p.code}
        onChange={(e) => {
          p.setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
        }}
      />
      <ErrorText error={p.error} />
      <button className="btn btn--primary btn--main" disabled={p.busy || p.code.length !== 6}>
        Войти
      </button>
      <p className="hint">
        Не пришло?{' '}
        <button type="button" className="link" disabled={p.busy} onClick={p.onResend}>
          {p.resent ? 'Отправили ещё раз' : 'Прислать ещё раз'}
        </button>{' '}
        ·{' '}
        <button type="button" className="link" onClick={p.onOtherEmail}>
          Другая почта
        </button>
      </p>
      <MailpitHint />
    </form>
  );
}

function MailpitHint(): ReactNode {
  if (!import.meta.env.DEV) return null;
  return (
    <p className="hint-sm">
      Локально письма не уходят наружу: код лежит в Mailpit,{' '}
      <a className="link" href="http://localhost:8025" target="_blank" rel="noreferrer">
        localhost:8025
      </a>
    </p>
  );
}

const GENDER_OPTIONS = [
  ['m', 'изменил'],
  ['f', 'изменила'],
  [null, 'не важно'],
] as const;

function ProfileStep(p: {
  name: string;
  setName: (v: string) => void;
  gender: Gender | null;
  setGender: (v: Gender | null) => void;
  busy: boolean;
  error: string | null;
  onSubmit: Submit;
}) {
  return (
    <form className="field" style={{ gap: 16 }} onSubmit={p.onSubmit}>
      <div className="field">
        <label htmlFor="name" className="field__label--strong">
          Как тебя зовут?
        </label>
        <input
          id="name"
          className="input"
          autoComplete="given-name"
          autoFocus
          maxLength={40}
          value={p.name}
          onChange={(e) => {
            p.setName(e.target.value);
          }}
        />
        <p className="hint-sm">Так тебя увидят в группе: «Аня заплатила за ужин».</p>
      </div>
      <div className="field">
        <span id="gender" className="field__label">
          Как писать о тебе
        </span>
        <div role="radiogroup" aria-labelledby="gender" className="segments">
          {GENDER_OPTIONS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={p.gender === value}
              onClick={() => {
                p.setGender(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorText error={p.error} />
      <button className="btn btn--primary btn--main" disabled={p.busy || !p.name.trim()}>
        Готово
      </button>
    </form>
  );
}
