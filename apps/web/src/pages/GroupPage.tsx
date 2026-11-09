import { byGender, currencySymbol, naiveTransferCount, type BalancesDto, type CurrencyCode, type ExpenseDto, type GroupDto, type MemberDto, type Transfer } from '@se/shared';
import { Link, NavLink, useParams } from 'react-router';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { ApiError } from '../lib/api.js';
import { copy, fill } from '../lib/copy.js';
import { CATEGORY_LABELS, countGenitive, money, moneyCur, shortDate, splitLabel, useBalances, useExpenses } from '../lib/expenses.js';
import { inviteLink, useGroup } from '../lib/groups.js';
import { dayMonth, joinNames, plural } from '../lib/ru.js';
import { useCurrentUser } from '../lib/session.js';
import { NotFoundPage } from './NotFoundPage.js';

type Tab = 'balance' | 'expenses' | 'feed';

/**
 * M02 / D02: экран группы. На телефоне три вкладки: баланс, расходы, лента.
 * На компьютере баланс всегда справа, а слева — таблица расходов (или лента).
 */
export function GroupPage({ tab }: { tab: Tab }) {
  const { id = '' } = useParams();
  const group = useGroup(id);
  const expenses = useExpenses(id);
  const balances = useBalances(id);
  const me = useCurrentUser();

  if (group.error instanceof ApiError && group.error.status === 404) return <NotFoundPage />;
  if (!group.data || !expenses.data || !balances.data) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  return <GroupView tab={tab} ctx={{ g: group.data, meId: me.id, expenses: expenses.data, balances: balances.data }} />;
}

function GroupView({ tab, ctx }: { tab: Tab; ctx: Ctx }) {
  const { g } = ctx;
  const open = g.status === 'open';
  return (
    <div className="page">
      <GroupHeader g={g} isOwner={g.ownerId === ctx.meId} tab={tab} />
      {!open && <ClosedBanner g={g} />}
      {open && (
        <div className="group-body desktop-only" style={{ padding: '20px 24px 0' }}>
          <Link to={`/groups/${g.id}/expenses/new`} className="btn btn--primary" style={{ height: 44 }}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            Расход
          </Link>
        </div>
      )}
      <GroupContent tab={tab} ctx={ctx} />
      {open && (
        <div className="add-bar mobile-only">
          <Link to={`/groups/${g.id}/expenses/new`} className="btn btn--primary btn--main">
            <Icon name="plus" size={20} strokeWidth={2.2} />
            Расход
          </Link>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ g, isOwner, tab }: { g: GroupDto; isOwner: boolean; tab: Tab }) {
  const symbol = currencySymbol(g.currency as CurrencyCode);
  return (
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
          <NavLink to={`/groups/${g.id}`} end className="mobile-only">
            {copy.group.tabs.balance}
          </NavLink>
          <NavLink to={`/groups/${g.id}/expenses`} className={({ isActive }) => (isActive || tab === 'balance' ? 'tab-desktop-active' : '')}>
            {copy.group.tabs.expenses}
          </NavLink>
          <NavLink to={`/groups/${g.id}/feed`}>{copy.group.tabs.feed}</NavLink>
        </nav>
      </div>
    </header>
  );
}

function ClosedBanner({ g }: { g: GroupDto }) {
  return (
    <div className="banner">
      <Icon name="lock" size={18} />
      {fill(copy.group.closedBanner, { date: g.closedAt ? dayMonth(g.closedAt) : '' })}
    </div>
  );
}

function GroupContent({ tab, ctx }: { tab: Tab; ctx: Ctx }) {
  if (ctx.expenses.length === 0) {
    return (
      <div className="group-body" style={{ maxWidth: 640 }}>
        {tab === 'feed' ? <FeedStub /> : <EmptyGroup group={ctx.g} meId={ctx.meId} />}
      </div>
    );
  }
  return (
    <div className="group-body group-grid">
      <main className={tab === 'balance' ? 'desktop-only' : ''}>{tab === 'feed' ? <FeedStub /> : <ExpensesPanel {...ctx} />}</main>
      <aside className={tab === 'balance' ? '' : 'desktop-only'}>
        <BalancePanel {...ctx} />
      </aside>
    </div>
  );
}

interface Ctx {
  g: GroupDto;
  meId: string;
  expenses: ExpenseDto[];
  balances: BalancesDto;
}

const nameOf = (g: GroupDto, userId: string) => g.members.find((m) => m.userId === userId)?.name ?? 'Бывший участник';

// ---------- Баланс ----------

function BalancePanel(ctx: Ctx) {
  return (
    <div className="balance-panel">
      <BalanceHero {...ctx} />
      {ctx.balances.transfers.length > 0 && <TransfersSection {...ctx} />}
      <BalancesSection {...ctx} />
      <section className="panel-section mobile-only">
        <div className="panel-section__head">
          <h2 className="section-title">Последние расходы</h2>
          <Link to={`/groups/${ctx.g.id}/expenses`} className="link" style={{ fontSize: 15 }}>
            Все {ctx.expenses.length}
          </Link>
        </div>
        <div className="list">
          {ctx.expenses.slice(0, 3).map((e) => (
            <ExpenseRow key={e.id} e={e} g={ctx.g} meId={ctx.meId} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** «Вернёт Гена.» / «Получат Аня и Борис.»: имена в именительном падеже, без склонения. */
function heroSub({ g, meId, balances }: Ctx, mine: number): string {
  const names = (ids: string[]) => joinNames(ids.map((id) => nameOf(g, id)));
  if (mine > 0) {
    const from = balances.transfers.filter((t) => t.toId === meId).map((t) => t.fromId);
    return `${from.length === 1 ? 'Вернёт' : 'Вернут'} ${names(from)}.`;
  }
  if (mine < 0) {
    const to = balances.transfers.filter((t) => t.fromId === meId).map((t) => t.toId);
    return `${to.length === 1 ? 'Получит' : 'Получат'} ${names(to)}.`;
  }
  return balances.transfers.length === 0 ? `${copy.balance.groupSettled}.` : 'Тебе никто не должен, и ты никому.';
}

function heroLabel(mine: number): string {
  if (mine > 0) return copy.balance.owedToYou;
  if (mine < 0) return copy.balance.youOwe;
  return copy.balance.settled;
}

/** plus / minus / нейтральный класс для суммы со знаком. */
const signClass = (v: number, zero = '') => (v > 0 ? 'plus' : v < 0 ? 'minus' : zero);

function BalanceHero(ctx: Ctx) {
  const mine = ctx.balances.balances.find((b) => b.userId === ctx.meId)?.amount ?? 0;
  return (
    <section className="hero">
      <p className="hero__label">{heroLabel(mine)}</p>
      {mine !== 0 && <p className={`hero__amount n ${signClass(mine)}`}>{moneyCur(Math.abs(mine), ctx.g.currency)}</p>}
      <p className="hero__sub">{heroSub(ctx, mine)}</p>
    </section>
  );
}

function TransfersSection({ g, meId, balances }: Ctx) {
  const count = balances.transfers.length;
  const people = balances.balances.filter((b) => b.amount !== 0).length;
  const amountClass = (t: Transfer) => (t.toId === meId ? ' plus' : t.fromId === meId ? ' minus' : '');
  return (
    <section className="panel-section">
      <div className="panel-section__head">
        <h2 className="section-title">{copy.balance.transfersTitle}</h2>
        <span className="hint-sm">
          {count} {plural(count, 'перевод', 'перевода', 'переводов')}
        </span>
      </div>
      <div className="list panel-list">
        {balances.transfers.map((t) => (
          <div key={`${t.fromId}:${t.toId}`} className={`row transfer${t.toId === meId ? ' transfer--to-me' : ''}`}>
            <span className="row__main transfer__who">
              <span>
                {t.fromId === meId ? <strong>ты</strong> : nameOf(g, t.fromId)}
                <span className="transfer__arrow" aria-label="переводит">
                  →
                </span>
                {t.toId === meId ? <strong>тебе</strong> : nameOf(g, t.toId)}
              </span>
            </span>
            <span className={`n transfer__amount${amountClass(t)}`}>{money(t.amount, g.currency)}</span>
          </div>
        ))}
      </div>
      {count < naiveTransferCount(people) && (
        <p className="hint-sm panel-note">{fill(copy.balance.transfersHint, { all: naiveTransferCount(people), min: countGenitive(count) })}</p>
      )}
    </section>
  );
}

function BalancesSection({ g, meId, balances }: Ctx) {
  return (
    <section className="panel-section">
      <div className="panel-section__head">
        <h2 className="section-title">Балансы</h2>
      </div>
      <div className="list panel-list">
        {balances.balances.map((b) => {
          const m = g.members.find((x) => x.userId === b.userId);
          const name = m?.name ?? 'Бывший участник';
          return (
            <div key={b.userId} className="row">
              <Avatar name={name} />
              <div className="row__main">
                <span className="row__title">
                  {name}
                  {b.userId === meId ? ' (ты)' : ''}
                </span>
                <span className="row__meta">{balanceNote(b.amount, m)}</span>
              </div>
              <span className={`n balance-amount ${signClass(b.amount, 'text-2')}`}>{money(b.amount, g.currency, true)}</span>
            </div>
          );
        })}
      </div>
      <p className="hint-sm panel-note check-line">
        <Icon name="check" size={16} />
        {copy.balance.sumCheck}
      </p>
    </section>
  );
}

/** Подпись под именем: «ей вернут», «с него», «в расчёте». Имена не склоняем, местоимение — по роду из профиля. */
function balanceNote(amount: number, m: MemberDto | undefined): string {
  if (amount === 0) return 'в расчёте';
  if (amount > 0) return m?.gender ? fill(copy.balance.rowOwed, { pronoun: byGender(m.gender, 'ему', 'ей') }) : 'вернут';
  return m?.gender ? fill(copy.balance.rowOwes, { pronounGen: byGender(m.gender, 'него', 'неё') }) : 'отдаст';
}

// ---------- Расходы ----------

function expenseMeta(e: ExpenseDto, g: GroupDto, meId: string): string {
  const payer = e.payerId === meId ? 'Ты' : nameOf(g, e.payerId);
  const edited = e.version > 1 ? `изменён ${shortDate(e.updatedAt)}` : shortDate(e.spentOn);
  return `${payer} · ${CATEGORY_LABELS[e.category].toLowerCase()} · ${edited}`;
}

function myShareText(e: ExpenseDto, g: GroupDto, meId: string): string {
  const share = e.shares.find((s) => s.userId === meId);
  return share ? fill(copy.expense.yourShare, { amount: money(share.amount, g.currency) }) : copy.expense.notYou;
}

function ExpenseRow({ e, g, meId }: { e: ExpenseDto; g: GroupDto; meId: string }) {
  const body = (
    <>
      <div className="row__main">
        <span className="row__title">{e.title || CATEGORY_LABELS[e.category]}</span>
        <span className="row__meta">{expenseMeta(e, g, meId)}</span>
      </div>
      <div className="expense-row__side">
        <span className="n expense-row__amount">{money(e.amount, g.currency)}</span>
        <span className="row__meta n">{myShareText(e, g, meId)}</span>
      </div>
    </>
  );
  return g.status === 'open' ? (
    <Link to={`/groups/${g.id}/expenses/${e.id}`} className="row expense-row">
      {body}
    </Link>
  ) : (
    <div className="row expense-row">{body}</div>
  );
}

function ExpensesPanel({ g, meId, expenses, balances }: Ctx) {
  const myTotal = expenses.reduce((s, e) => s + (e.shares.find((x) => x.userId === meId)?.amount ?? 0), 0);
  const count = `${expenses.length} ${plural(expenses.length, 'расход', 'расхода', 'расходов')}`;
  return (
    <>
      {/* Телефон: список */}
      <div className="mobile-only">
        <div className="list">
          {expenses.map((e) => (
            <ExpenseRow key={e.id} e={e} g={g} meId={meId} />
          ))}
        </div>
        <p className="hint-sm" style={{ margin: '12px 20px 0' }}>
          Всего {count} на <span className="n">{moneyCur(balances.totalSpent, g.currency)}</span>, твоя доля{' '}
          <span className="n">{money(myTotal, g.currency)}</span>.
        </p>
      </div>

      {/* Компьютер: таблица D02 */}
      <div className="card desktop-only" style={{ overflowX: 'auto' }}>
        <table className="table expenses-table">
          <thead>
            <tr>
              <th>Что</th>
              <th>Платил</th>
              <th>Деление</th>
              <th className="num">Сумма</th>
              <th className="num">Твоя доля</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const share = e.shares.find((s) => s.userId === meId);
              return (
                <tr key={e.id}>
                  <td>
                    {g.status === 'open' ? (
                      <Link to={`/groups/${g.id}/expenses/${e.id}`} className="expenses-table__title">
                        {e.title || CATEGORY_LABELS[e.category]}
                      </Link>
                    ) : (
                      <span className="expenses-table__title">{e.title || CATEGORY_LABELS[e.category]}</span>
                    )}
                    <span className="hint-sm" style={{ display: 'block' }}>
                      {CATEGORY_LABELS[e.category].toLowerCase()} · {shortDate(e.spentOn)}
                      {e.version > 1 && ` · изменён ${shortDate(e.updatedAt)}`}
                    </span>
                  </td>
                  <td>{e.payerId === meId ? 'Ты' : nameOf(g, e.payerId)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{splitLabel(e, g.memberCount)}</td>
                  <td className="num n" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {money(e.amount, g.currency)}
                  </td>
                  <td className="num n">{share ? money(share.amount, g.currency) : 'не участвуешь'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Всего {count}</td>
              <td className="num n">{money(balances.totalSpent, g.currency)}</td>
              <td className="num n">{money(myTotal, g.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function FeedStub() {
  return (
    <section style={{ padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="empty__title">Здесь будет история группы</p>
      <p className="text-2" style={{ fontSize: 15 }}>
        Кто что добавил, изменил и погасил. Появится на следующем этапе разработки.
      </p>
    </section>
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
          <button className="btn btn--outline" style={{ height: 44 }} onClick={() => void copyLink()}>
            <Icon name="link" size={16} />
            Скопировать ссылку
          </button>
        </div>
      )}

      <section style={{ marginTop: 32, paddingBottom: 100 }}>
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
    </>
  );
}
