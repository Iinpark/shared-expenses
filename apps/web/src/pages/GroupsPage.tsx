import type { GroupSummaryDto } from '@se/shared';
import { currencySymbol, type CurrencyCode } from '@se/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import { ProfileMenu } from '../components/ProfileMenu.js';
import { api } from '../lib/api.js';
import { copy } from '../lib/copy.js';
import { money, moneyCur } from '../lib/expenses.js';
import { dayMonth, members } from '../lib/ru.js';
import { useMe } from '../lib/session.js';

const symbol = (c: string) => {
  try {
    return currencySymbol(c as CurrencyCode);
  } catch {
    return c;
  }
};

/** Баланс в группе для строки списка: «тебе вернут 3 166,66 ₽», «с тебя …», «в расчёте». */
function BalanceSide({ g }: { g: GroupSummaryDto }) {
  if (g.myBalance === 0) return <span className="hint-sm">в расчёте</span>;
  return (
    <>
      <span className="hint-sm">{g.myBalance > 0 ? 'тебе вернут' : 'с тебя'}</span>
      <span className={`n ${g.myBalance > 0 ? 'plus' : 'minus'}`} style={{ fontWeight: 600, fontSize: 16 }}>
        {moneyCur(Math.abs(g.myBalance), g.currency)}
      </span>
    </>
  );
}

/** Общий итог по всем группам — отдельно по каждой валюте, без сложения разных валют. */
function Totals({ list }: { list: GroupSummaryDto[] }) {
  const byCurrency = new Map<string, number>();
  for (const g of list) byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + g.myBalance);
  const totals = [...byCurrency].filter(([, v]) => v !== 0);
  if (!totals.length) return null;
  return (
    <section className="card totals">
      <h2 className="section-label">{copy.group.total}</h2>
      <div className="totals__items">
        {totals.map(([currency, v]) => (
          <div key={currency} className="totals__item">
            <span className="hint">{v > 0 ? copy.balance.owedToYou : copy.balance.youOwe}</span>
            <span className={`n totals__amount ${v > 0 ? 'plus' : 'minus'}`}>{moneyCur(Math.abs(v), currency)}</span>
          </div>
        ))}
      </div>
      {byCurrency.size > 1 && <p className="hint-sm">{copy.balance.currenciesNote}</p>}
    </section>
  );
}

/** M01 / D01: список групп с балансом в каждой и общим итогом по валютам. */
export function GroupsPage() {
  const me = useMe().data!;
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<GroupSummaryDto[]>('GET', '/api/groups') });
  const list = groups.data ?? [];
  const open = list.filter((g) => g.status === 'open');
  const closed = list.filter((g) => g.status === 'closed');

  if (groups.isSuccess && list.length === 0) {
    return (
      <div className="page" style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}>
        <div className="groups-m__head">
          <h1 className="screen-title">{copy.group.groups}</h1>
          <ProfileMenu me={me} compact />
        </div>
        <div className="empty">
          <p className="empty__title">{copy.empty.noGroupsTitle}</p>
          <p className="text-2" style={{ fontSize: 15 }}>
            {copy.empty.noGroupsText}
          </p>
          <Link to="/groups/new" className="btn btn--primary" style={{ marginTop: 8, height: 52, borderRadius: 12, fontSize: 16 }}>
            Создать группу
          </Link>
          <p className="hint">{copy.empty.noGroupsInvited}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Телефон: M01 */}
      <div className="groups-m">
        <header className="groups-m__head">
          <h1 className="screen-title">{copy.group.groups}</h1>
          <ProfileMenu me={me} compact />
        </header>
        {groups.isPending && <p className="hint" style={{ padding: '12px 20px' }}>Загружаем…</p>}
        <div style={{ padding: '12px 20px 0' }}>
          <Totals list={list} />
        </div>
        {open.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 className="section-label" style={{ margin: '0 20px 8px' }}>
              {copy.group.open}
            </h2>
            <div className="list">
              {open.map((g) => (
                <Link key={g.id} to={`/groups/${g.id}`} className="group-link">
                  <div className="row__main" style={{ gap: 4 }}>
                    <span className="group-link__name">{g.name}</span>
                    <span className="group-link__meta">
                      {symbol(g.currency)} · {members(g.memberCount)}
                    </span>
                  </div>
                  <div className="group-link__side">
                    <BalanceSide g={g} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        {closed.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <h2 className="section-label" style={{ margin: '0 20px 8px' }}>
              {copy.group.closed}
            </h2>
            <div className="list">
              {closed.map((g) => (
                <Link key={g.id} to={`/groups/${g.id}`} className="group-link">
                  <div className="row__main" style={{ gap: 4 }}>
                    <span className="group-link__name text-2">
                      <Icon name="lock" size={16} />
                      {g.name}
                    </span>
                    <span className="group-link__meta">
                      {symbol(g.currency)} · закрыта {g.closedAt ? dayMonth(g.closedAt) : ''}
                    </span>
                  </div>
                  <div className="group-link__side">
                    <BalanceSide g={g} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        <div style={{ padding: '28px 20px 0' }}>
          <Link to="/groups/new" className="btn btn--outline" style={{ width: '100%', height: 52, borderRadius: 12, fontSize: 16 }}>
            <Icon name="plus" />
            {copy.group.newGroup}
          </Link>
        </div>
      </div>

      {/* Компьютер: D01 */}
      <div className="groups-d">
        <header className="appbar">
          <div className="container appbar__inner">
            <span style={{ fontWeight: 600 }}>Совместные расходы</span>
            <ProfileMenu me={me} />
          </div>
        </header>
        <main className="container" style={{ padding: '40px 24px 64px', display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
            <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-.02em' }}>{copy.group.groups}</h1>
            <Link to="/groups/new" className="btn btn--primary" style={{ height: 44 }}>
              <Icon name="plus" size={18} strokeWidth={2.2} />
              {copy.group.newGroup}
            </Link>
          </div>
          <Totals list={list} />
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)' }}>Все группы</h2>
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Группа</th>
                    <th>Участники</th>
                    <th>Твой баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link to={`/groups/${g.id}`} style={{ fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {g.status === 'closed' && <Icon name="lock" size={15} />}
                          {g.name}
                        </Link>
                        <span className="hint-sm" style={{ display: 'block', marginTop: 2 }}>
                          {symbol(g.currency)} · {g.status === 'open' ? 'открыта' : `закрыта ${g.closedAt ? dayMonth(g.closedAt) : ''}`}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span className="avatars">
                            {g.memberNames.slice(0, 4).map((n, i) => (
                              <Avatar key={i} name={n} />
                            ))}
                          </span>
                          {g.memberCount <= 4 ? g.memberNames.join(', ') : members(g.memberCount)}
                        </span>
                      </td>
                      <td>
                        {g.myBalance === 0 ? (
                          <span className="hint">в расчёте</span>
                        ) : (
                          <span className={`n ${g.myBalance > 0 ? 'plus' : 'minus'}`} style={{ fontWeight: 600 }}>
                            {money(g.myBalance, g.currency, true)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
