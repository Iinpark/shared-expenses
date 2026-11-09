import type { CurrencyCode, GroupDto } from '@se/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { CurrencyPicker, currencyLabel } from '../components/CurrencyPicker.js';
import { EmailChips } from '../components/EmailChips.js';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { api, ApiError, errorText } from '../lib/api.js';
import { copy } from '../lib/copy.js';
import { inviteLink, useGroup } from '../lib/groups.js';
import { useMe } from '../lib/session.js';
import { NotFoundPage } from './NotFoundPage.js';

/** D04: настройки группы. Менять может только создатель, остальные видят участников и могут позвать людей. */
export function SettingsPage() {
  const { id = '' } = useParams();
  const group = useGroup(id);
  const me = useMe().data!;
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('KZT');
  const [days, setDays] = useState('7');
  const [emails, setEmails] = useState<string[]>([]);
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const g = group.data;
  useEffect(() => {
    if (!g) return;
    setName(g.name);
    setCurrency(g.currency as CurrencyCode);
    setDays(String(g.reminderDays));
  }, [g?.id, g?.name, g?.currency, g?.reminderDays]);

  if (group.error instanceof ApiError && group.error.status === 404) return <NotFoundPage />;
  if (!g) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;

  const isOwner = g.ownerId === me.id;
  const canEdit = isOwner && g.status === 'open';
  const daysValid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 90;
  const dirty = name.trim() !== g.name || currency !== g.currency || Number(days) !== g.reminderDays;

  async function act(fn: () => Promise<GroupDto>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      qc.setQueryData(['group', id], updated);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      if (done) toast(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(() => api<GroupDto>('PATCH', `/api/groups/${id}`, { name, currency, reminderDays: Number(days) }), 'Настройки сохранены');

  const sendInvites = () =>
    act(async () => {
      const updated = await api<GroupDto>('POST', `/api/groups/${id}/invites`, { emails });
      setEmails([]);
      setShowEmail(false);
      return updated;
    }, 'Приглашения отправлены');

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink(g.inviteToken));
    toast('Ссылка скопирована');
  };

  const rotate = () => act(() => api<GroupDto>('POST', `/api/groups/${id}/invite-link/rotate`), 'Новая ссылка готова, старая больше не работает');

  return (
    <div className="page">
      <header className="appbar">
        <div className="container appbar__inner" style={{ justifyContent: 'flex-start', maxWidth: 720, padding: '0 20px' }}>
          <Link to={`/groups/${g.id}`} style={{ height: 44, display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 500 }}>
            <Icon name="back" />
            {g.name}
          </Link>
        </div>
      </header>

      <main className="container" style={{ padding: '32px 20px 64px', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.02em' }}>{isOwner ? 'Настройки группы' : 'О группе'}</h1>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {canEdit ? (
            <>
              <div className="field">
                <label htmlFor="n" className="field__label">
                  {copy.group.name}
                </label>
                <input id="n" className="input" style={{ height: 48, fontSize: 16, maxWidth: 420 }} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {g.currencyLocked ? (
                <CurrencyLocked currency={g.currency} />
              ) : (
                <div style={{ maxWidth: 420 }}>
                  <CurrencyPicker value={currency} onChange={setCurrency} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label htmlFor="d">Напомнить письмом тому, кто не рассчитался за</label>
                <input id="d" className="input input--days n" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                <span>{copy.group.days}</span>
              </div>
              {!daysValid && <p className="field-error" style={{ marginTop: -8 }}>От 1 до 90 дней</p>}
              <p className="hint" style={{ marginTop: -8 }}>
                Не чаще раза в неделю. Пока есть неподтверждённое погашение на всю сумму, письмо не уходит.
              </p>
              {dirty && (
                <button className="btn btn--primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim() || !daysValid || !dirty} onClick={save}>
                  Сохранить
                </button>
              )}
            </>
          ) : (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 20, rowGap: 12, fontSize: 15 }}>
              <dt className="hint">Валюта</dt>
              <dd style={{ margin: 0 }}>{currencyLabel(g.currency)}</dd>
              <dt className="hint">Напоминание</dt>
              <dd style={{ margin: 0 }}>через {g.reminderDays} дн., если не рассчитались</dd>
            </dl>
          )}
          {error && <p className="field-error">{error}</p>}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 28, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>Участники</h2>
            {g.status === 'open' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn--sm" onClick={copyLink}>
                  <Icon name="link" size={16} />
                  Ссылка-приглашение
                </button>
                <button className="btn btn--sm" onClick={() => setShowEmail((v) => !v)}>
                  <Icon name="mail" size={16} />
                  По почте
                </button>
              </div>
            )}
          </div>

          {showEmail && (
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label htmlFor="mail" className="field__label">
                Кого позвать
              </label>
              <EmailChips id="mail" value={emails} onChange={setEmails} />
              <button className="btn btn--primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !emails.length} onClick={sendInvites}>
                Отправить приглашения
              </button>
            </div>
          )}

          <div className="card list">
            {g.members.map((m) => (
              <div key={m.userId} className="row" style={{ padding: '8px 16px', minHeight: 56 }}>
                <Avatar name={m.name} />
                <span style={{ flex: 1, fontSize: 15 }}>
                  {m.name}
                  {m.userId === me.id ? ' (ты)' : ''} <span className="hint">· {m.email}</span>
                </span>
                {m.isOwner && <span className="hint">создатель</span>}
              </div>
            ))}
            {g.pendingInvites.map((i) => (
              <div key={i.id} className="row" style={{ padding: '8px 16px', minHeight: 56 }}>
                <span className="avatar avatar--pending" />
                <span style={{ flex: 1, fontSize: 15 }} className="text-2">
                  {i.email}
                </span>
                <span className="hint">приглашение отправлено</span>
              </div>
            ))}
          </div>

          {isOwner && g.status === 'open' && (
            <p className="hint">
              Ссылка попала не туда?{' '}
              <button className="link" disabled={busy} onClick={rotate}>
                Сделать новую
              </button>
              : старая перестанет работать.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function CurrencyLocked({ currency }: { currency: string }) {
  return (
    <div className="field">
      <span className="field__label">Валюта</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Icon name="lock" size={16} />
        {currencyLabel(currency)}{' '}
        <span className="hint">· в группе уже есть расходы, валюту не поменять</span>
      </span>
    </div>
  );
}
