import { byGender, currencySymbol, type CurrencyCode, type GroupDto } from '@se/shared';
import { Link, NavLink, useParams } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { ApiError } from '../lib/api.js';
import { copy, fill } from '../lib/copy.js';
import { inviteLink, useGroup } from '../lib/groups.js';
import { dayMonth, joinNames } from '../lib/ru.js';
import { useMe } from '../lib/session.js';
import { NotFoundPage } from './NotFoundPage.js';

type Tab = 'balance' | 'expenses' | 'feed';

/**
 * M02 / D02: экран группы. Пока в группе нет расходов, все три раздела показывают
 * пустое состояние из S02; балансы, расходы и лента появятся на следующих этапах.
 */
export function GroupPage({ tab }: { tab: Tab }) {
  const { id = '' } = useParams();
  const group = useGroup(id);
  const me = useMe().data!;

  if (group.error instanceof ApiError && group.error.status === 404) return <NotFoundPage />;
  if (!group.data) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  const g = group.data;
  const symbol = currencySymbol(g.currency as CurrencyCode);
  const isOwner = g.ownerId === me.id;

  return (
    <div className="page">
      <header className="group-head">
        <div className="group-body">
          <div className="group-head__bar">
            <Link to="/" aria-label="Назад к группам" className="icon-btn">
              <Icon name="back" size={24} />
            </Link>
            <div className="group-head__title">
              <span className="group-head__name">
                {g.status === 'closed' && <Icon name="lock" size={16} />}
                {g.name}
              </span>
              <span className="group-head__sub">
                {symbol} · {g.memberNames.join(', ')}
              </span>
            </div>
            <Link to={`/groups/${g.id}/settings`} aria-label={isOwner ? 'Настройки группы' : 'Участники группы'} className="icon-btn">
              <Icon name="settings" size={22} />
            </Link>
          </div>
          <nav aria-label="Разделы группы" className="tabs">
            <NavLink to={`/groups/${g.id}`} end>
              {copy.group.tabs.balance}
            </NavLink>
            <NavLink to={`/groups/${g.id}/expenses`}>{copy.group.tabs.expenses}</NavLink>
            <NavLink to={`/groups/${g.id}/feed`}>{copy.group.tabs.feed}</NavLink>
          </nav>
        </div>
      </header>

      {g.status === 'closed' && (
        <div className="banner">
          <Icon name="lock" size={18} />
          {fill(copy.group.closedBanner, { date: g.closedAt ? dayMonth(g.closedAt) : '' })}
        </div>
      )}

      <div className="group-body" style={{ maxWidth: 640 }}>
        {tab === 'feed' ? (
          <section style={{ padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="empty__title">Здесь будет история группы</p>
            <p className="text-2" style={{ fontSize: 15 }}>
              Кто что добавил, изменил и погасил. Появится вместе с первым расходом.
            </p>
          </section>
        ) : (
          <EmptyGroup group={g} meId={me.id} />
        )}
      </div>
    </div>
  );
}

/** S02 «Пусто: нет расходов»: что делать дальше и кого позвать. */
function EmptyGroup({ group: g, meId }: { group: GroupDto; meId: string }) {
  const toast = useToast();
  const me = g.members.find((m) => m.userId === meId);
  const alone = g.memberCount === 1;
  const waiting = g.pendingInvites.map((i) => i.email);

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink(g.inviteToken));
    toast('Ссылка скопирована. Отправь её в любой мессенджер.');
  };

  return (
    <>
      <section style={{ padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="empty__title">{copy.empty.noExpensesTitle}</p>
        <p className="text-2" style={{ fontSize: 15 }}>
          {copy.empty.noExpensesText}
        </p>
      </section>

      {g.status === 'open' && (
        <div className="notice" style={{ margin: '0 20px' }}>
          <p style={{ fontSize: 15, lineHeight: 1.45 }}>
            {alone ? (
              <>
                <strong>Ты пока {byGender(me?.gender, 'один', 'одна')} в группе.</strong>{' '}
                {waiting.length ? `${joinNames(waiting)} ещё не открыли приглашение.` : 'Позови тех, с кем делите расходы.'}
              </>
            ) : waiting.length ? (
              <>Ещё не открыли приглашение: {joinNames(waiting)}.</>
            ) : (
              <>Позвать ещё кого-то можно по ссылке.</>
            )}
          </p>
          <button className="btn btn--outline" style={{ height: 44 }} onClick={copyLink}>
            <Icon name="link" size={16} />
            Скопировать ссылку
          </button>
        </div>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 className="section-title" style={{ margin: '0 20px 10px' }}>
          Участники
        </h2>
        <div className="list">
          {g.members.map((m) => (
            <div key={m.userId} className="row">
              <Avatar name={m.name} />
              <div className="row__main">
                <span className="row__title">
                  {m.name}
                  {m.userId === meId ? ' (ты)' : ''}
                </span>
                {m.isOwner && <span className="row__meta">создатель</span>}
              </div>
              <span className="hint">в расчёте</span>
            </div>
          ))}
        </div>
      </section>
      <p className="hint-sm" style={{ margin: '24px 20px' }}>
        Кнопка «Расход» появится на следующем этапе разработки.
      </p>
    </>
  );
}
