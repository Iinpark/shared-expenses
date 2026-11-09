import { byGender, type InvitePreviewDto, type Me } from '@se/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { currencyLabel } from '../components/CurrencyPicker.js';
import { AuthFlow } from '../components/AuthFlow.js';
import { api, ApiError, errorText } from '../lib/api.js';
import { copy } from '../lib/copy.js';
import { joinNames } from '../lib/ru.js';
import { useMe } from '../lib/session.js';
import { NotFoundPage } from './NotFoundPage.js';

/** M10: приглашение по ссылке. Устаревшая ссылка — M12. */
export function InvitePage() {
  const { token = '' } = useParams();
  const me = useMe().data;

  const preview = useQuery({
    queryKey: ['invite', token, me?.id ?? null],
    queryFn: () => api<InvitePreviewDto>('GET', `/api/invites/${token}`),
    retry: false,
  });

  if (preview.error instanceof ApiError && preview.error.status === 404) return <NotFoundPage />;
  const p = preview.data;
  if (!p) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  if (p.status === 'expired') return <InviteExpired preview={p} />;

  return (
    <div className="solo">
      <p className="solo__brand">Совместные расходы</p>
      <section className="solo__body">
        <p className="lead">{p.inviterName} зовёт тебя в группу</p>
        <h1 className="title">{p.groupName}</h1>
        <p className="text-2">Здесь записывают, кто за кого платил, и считают, кто кому сколько должен. Деньги приложение не переводит.</p>
      </section>

      <dl
        style={{
          margin: '28px 0 0',
          padding: '16px 0',
          borderTop: '1px solid #D5D8DE',
          borderBottom: '1px solid #D5D8DE',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 20,
          rowGap: 12,
          fontSize: 15,
        }}
      >
        <dt className="hint" style={{ fontSize: 15 }}>
          Уже внутри
        </dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="avatars">
            {p.memberNames.slice(0, 4).map((n, i) => (
              <Avatar key={i} name={n} />
            ))}
          </span>
          {joinNames(p.memberNames)}
        </dd>
        <dt className="hint" style={{ fontSize: 15 }}>
          Валюта
        </dt>
        <dd style={{ margin: 0 }}>{currencyLabel(p.currency)}</dd>
      </dl>

      <div style={{ marginTop: 28 }}>
        <InviteAction token={token} preview={p} me={me ?? null} />
      </div>

      <p className="solo__foot">Не знаешь, кто зовёт? Просто закрой страницу, в группу тебя не добавят.</p>
    </div>
  );
}

/** Кнопка под приглашением: открыть группу, вступить или сначала войти. */
function InviteAction({ token, preview: p, me }: { token: string; preview: Extract<InvitePreviewDto, { status: 'valid' }>; me: Me | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const { groupId } = await api<{ groupId: string }>('POST', `/api/invites/${token}/accept`);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      await navigate(`/groups/${groupId}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (p.alreadyMember) {
    return (
      <Link to={`/groups/${p.groupId}`} className="btn btn--primary btn--main">
        Ты уже в группе. Открыть
      </Link>
    );
  }
  if (!me?.name) return <AuthFlow submitLabel="Присоединиться" onDone={() => void join()} />;
  return (
    <div className="field" style={{ gap: 10 }}>
      <p className="hint">
        Ты войдёшь как {me.name} ({me.email}).
      </p>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn--primary btn--main" disabled={busy} onClick={() => void join()}>
        Присоединиться
      </button>
    </div>
  );
}

function InviteExpired({ preview: p }: { preview: Extract<InvitePreviewDto, { status: 'expired' }> }) {
  const text =
    p.reason === 'rotated'
      ? `${p.inviterName} ${byGender(p.inviterGender, 'обновил', 'обновила')} ссылку-приглашение в «${p.groupName}», и эта ссылка больше не работает. Новая заменила её.`
      : p.reason === 'closed'
        ? `Группа «${p.groupName}» закрыта, в неё больше не зовут.`
        : `Ссылка-приглашение в «${p.groupName}» устарела: приглашения действуют две недели.`;

  return (
    <div className="solo">
      <p className="solo__brand">Совместные расходы</p>
      <section className="solo__body solo__body--center">
        <h1 className="big-title">{copy.fun.inviteExpiredTitle}</h1>
        <p className="lead">{text}</p>
        {p.reason !== 'closed' && <p className="lead">Попроси прислать свежую ссылку.</p>}
        <Link to="/" className="btn btn--outline btn--main" style={{ marginTop: 12 }}>
          {copy.fun.inviteExpiredButton}
        </Link>
      </section>
      <p className="solo__foot" style={{ marginTop: 0 }}>
        Приглашения действуют недолго, чтобы старая ссылка не попала к посторонним.
      </p>
    </div>
  );
}
