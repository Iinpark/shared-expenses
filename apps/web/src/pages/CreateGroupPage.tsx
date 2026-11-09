import type { CurrencyCode, GroupDto } from '@se/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { CurrencyPicker } from '../components/CurrencyPicker.js';
import { EmailChips } from '../components/EmailChips.js';
import { Icon } from '../components/Icon.js';
import { api, errorText } from '../lib/api.js';
import { copy, fill } from '../lib/copy.js';
import { peopleCount } from '../lib/ru.js';
import { useCurrentUser } from '../lib/session.js';

/** M09: создание группы и приглашение. */
export function CreateGroupPage() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('KZT');
  const [days, setDays] = useState('7');
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reminderDays = Number(days);
  const daysValid = Number.isInteger(reminderDays) && reminderDays >= 1 && reminderDays <= 90;

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const group = await api<GroupDto>('POST', '/api/groups', { name, currency, reminderDays, inviteEmails: emails });
      qc.setQueryData(['group', group.id], group);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      await navigate(`/groups/${group.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="page page--white form-page" onSubmit={(e) => void submit(e)}>
      <header className="sheet-head">
        <Link to="/" aria-label="Закрыть" className="icon-btn">
          <Icon name="close" size={22} />
        </Link>
        <span className="sheet-head__title">{copy.group.newGroup}</span>
      </header>

      <section className="form-section">
        <div className="field">
          <label htmlFor="name" className="field__label">
            {copy.group.name}
          </label>
          <input id="name" className="input" style={{ fontSize: 18, fontWeight: 500 }} autoFocus maxLength={60} placeholder="Поездка в Казань" value={name} onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <CurrencyPicker value={currency} onChange={setCurrency} />
        <div className="inline-field">
          <label htmlFor="days" style={{ fontSize: 16, lineHeight: 1.35 }}>
            {copy.group.reminder}
          </label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input id="days" className="input input--days n" inputMode="numeric" value={days} onChange={(e) => {
                setDays(e.target.value.replace(/\D/g, '').slice(0, 2));
              }}
            />
            <span>{copy.group.days}</span>
          </span>
        </div>
        {!daysValid && <p className="field-error">От 1 до 90 дней</p>}
      </section>

      <section className="form-section" style={{ gap: 16 }}>
        <h2 className="section-title">{copy.group.invite}</h2>
        <div className="field" style={{ gap: 8 }}>
          <span className="field__label">{copy.group.inviteLink}</span>
          <div className="copy-row">
            <span className="copy-row__value">Ссылка появится сразу после создания группы</span>
          </div>
        </div>
        <div className="field" style={{ gap: 8 }}>
          <label htmlFor="mail" className="field__label">
            {copy.group.inviteEmail}
          </label>
          <EmailChips id="mail" value={emails} onChange={setEmails} />
          <p className="hint-sm">Каждому придёт письмо с кнопкой «Присоединиться».</p>
        </div>
        <div style={{ borderTop: '1px solid var(--line-soft)' }}>
          <div className="row" style={{ padding: '10px 0' }}>
            <Avatar name={me.name ?? me.email} />
            <span style={{ flex: 1, fontSize: 15 }}>{me.name} (ты)</span>
            <span className="hint">создатель</span>
          </div>
          {emails.map((e) => (
            <div key={e} className="row" style={{ padding: '10px 0' }}>
              <span className="avatar avatar--pending" />
              <span style={{ flex: 1, fontSize: 15 }} className="text-2">
                {e}
              </span>
              <span className="hint">получит письмо</span>
            </div>
          ))}
        </div>
      </section>

      <div className="form-foot">
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn--primary btn--main" disabled={busy || !name.trim() || !daysValid}>
          {emails.length ? fill(copy.group.createAndInvite, { n: peopleCount(emails.length) }) : 'Создать группу'}
        </button>
        <p className="hint-sm" style={{ textAlign: 'center' }}>
          Позвать можно и потом, из настроек группы
        </p>
      </div>
    </form>
  );
}
