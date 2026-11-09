import { byGender, currencySymbol, type CurrencyCode, type ExpenseDto, type GroupDto, type GroupReportDto, type ReportMemberDto, type SettlementDto } from '@se/shared';
import { Link, useParams } from 'react-router';
import { ClosedBanner } from '../components/ClosedBanner.js';
import { Icon } from '../components/Icon.js';
import { ReceiptMark } from '../components/ReceiptMark.js';
import { memberOf } from '../lib/events.js';
import { CATEGORY_LABELS, money, moneyCur, splitLabel } from '../lib/format.js';
import { ApiError, useCurrentUser, useExpenses, useGroup, useGroupReport } from '../lib/queries/index.js';
import { plural } from '../lib/ru.js';
import { NotFoundPage } from './NotFoundPage.js';

/**
 * D05: итоговый отчёт группы, /groups/:id/report — ссылка из письма E03. Открыт любому участнику,
 * в закрытой группе и в открытой (тогда это итог на сейчас).
 */
export function ReportPage() {
  const { id = '' } = useParams();
  const report = useGroupReport(id);
  const group = useGroup(id);
  const expenses = useExpenses(id);
  const me = useCurrentUser();
  const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);
  if (missing(report.error) || missing(group.error)) return <NotFoundPage />;
  if (!report.data || !group.data) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  return <ReportView r={report.data} g={group.data} meId={me.id} expenses={expenses.data ?? []} />;
}

interface Ctx {
  r: GroupReportDto;
  g: GroupDto;
  meId: string;
}

const signClass = (v: number) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nameOf = ({ r, g }: Ctx, id: string) => r.members.find((m) => m.userId === id)?.name ?? memberOf(g, id)?.name ?? 'Бывший участник';

const MONTHS_GEN = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
/** Дата траты YYYY-MM-DD как местная дата: «16 октября». */
const localDay = (ymd: string) => {
  const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
  return MONTHS_GEN.format(new Date(y, m - 1, d));
};

/** «16–18 октября», «30 декабря – 2 января», «16 октября». */
function periodText(p: GroupReportDto['period']): string | null {
  if (!p) return null;
  if (p.from === p.to) return localDay(p.from);
  const [from, to] = [localDay(p.from), localDay(p.to)];
  const [fromDay, fromMonth] = from.split(' ');
  const [toDay, toMonth] = to.split(' ');
  return fromMonth === toMonth ? `${fromDay ?? ''}–${toDay ?? ''} ${toMonth ?? ''}` : `${from} – ${to}`;
}

function ReportView({ r, g, meId, expenses }: Ctx & { expenses: ExpenseDto[] }) {
  const c: Ctx = { r, g, meId };
  const sub = [currencySymbol(r.currency as CurrencyCode), r.members.map((m) => m.name).join(', '), periodText(r.period)].filter(Boolean).join(' · ');
  return (
    <div className="page">
      <header className="appbar">
        <div className="container appbar__inner report-bar">
          <Link to={`/groups/${g.id}`} className="report-bar__back">
            <Icon name="back" />
            {g.name}
          </Link>
        </div>
      </header>
      {r.status === 'closed' && <ClosedBanner g={g} isOwner={g.ownerId === meId} />}
      <main className="container report">
        <div className="report__head">
          <h1 className="report__title">{r.name}: итог</h1>
          <span className="report__sub">{sub}</span>
          {r.status === 'open' && <span className="hint">Группа ещё открыта: это итог на сейчас, цифры могут измениться.</span>}
        </div>
        <Tiles {...c} />
        <MembersTable {...c} />
        <div className="report__cols">
          <div className="report__col">
            {r.transfers.length > 0 && <TransfersLeft {...c} />}
            <SettlementsList {...c} />
          </div>
          <ExpensesList c={c} expenses={expenses} />
        </div>
      </main>
    </div>
  );
}

// ---------- Плитки ----------

function Tiles({ r, meId }: Ctx) {
  const mine = r.members.find((m) => m.userId === meId);
  const left = sum(r.transfers.map((t) => t.amount));
  return (
    <section className="report-tiles" aria-label="Коротко">
      <div className="report-tile">
        <span className="report-tile__label">Потрачено вместе</span>
        <span className="n report-tile__value">{moneyCur(r.totalSpent, r.currency)}</span>
      </div>
      <div className="report-tile">
        <span className="report-tile__label">Твоя доля</span>
        <span className="n report-tile__value">{mine ? moneyCur(mine.share, r.currency) : '—'}</span>
      </div>
      <div className="report-tile">
        <span className="report-tile__label">Итог</span>
        {left === 0 ? (
          <span className="report-tile__value report-tile__done">
            <Icon name="check" size={24} strokeWidth={2.4} />
            Все в расчёте
          </span>
        ) : (
          <span className="report-tile__value">
            Осталось перевести <span className="n">{moneyCur(left, r.currency)}</span>
          </span>
        )}
      </div>
    </section>
  );
}

// ---------- Кто сколько заплатил и отдал ----------

/** «получила 20 200,00» / «отдал 7 800,00» по полу; без погашений — прочерк. */
function settledText(c: Ctx, m: ReportMemberDto): string {
  if (m.settled === 0) return '—';
  const gender = memberOf(c.g, m.userId)?.gender;
  const verb = m.settled > 0 ? byGender(gender, 'отдал', 'отдала') : byGender(gender, 'получил', 'получила');
  return `${verb} ${money(Math.abs(m.settled), c.r.currency)}`;
}

const signed = (v: number, cur: string) => (v === 0 ? money(0, cur) : money(v, cur, true));

/** Сверка: суммы столбцов. Заплатили столько же, сколько составили доли, балансы в сумме дают ноль. */
function totals(r: GroupReportDto) {
  const confirmed = r.settlements.filter((s) => s.status === 'confirmed');
  return {
    paid: sum(r.members.map((m) => m.paid)),
    share: sum(r.members.map((m) => m.share)),
    before: sum(r.members.map((m) => m.paid - m.share)),
    settled: sum(confirmed.map((s) => s.amount)),
    balance: sum(r.members.map((m) => m.balance)),
  };
}

function MembersTable(c: Ctx) {
  const { r, meId } = c;
  const t = totals(r);
  const who = (m: ReportMemberDto) => `${m.name}${m.userId === meId ? ' (ты)' : ''}`;
  return (
    <section className="report-section">
      <h2 className="report-section__title">Кто сколько заплатил и отдал</h2>
      <div className="card report-table-wrap desktop-only">
        <table className="report-table n">
          <thead>
            <tr>
              <th>Участник</th>
              <th>Заплатил</th>
              <th>Его доля</th>
              <th>Баланс до расчёта</th>
              <th>Погашения</th>
              <th>Итог</th>
            </tr>
          </thead>
          <tbody>
            {r.members.map((m) => (
              <tr key={m.userId}>
                <td>{who(m)}</td>
                <td>{money(m.paid, r.currency)}</td>
                <td>{money(m.share, r.currency)}</td>
                <td className={signClass(m.paid - m.share)}>{signed(m.paid - m.share, r.currency)}</td>
                <td>{settledText(c, m)}</td>
                <td className={`report-table__total ${signClass(m.balance)}`}>{signed(m.balance, r.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Сверка</td>
              <td>{money(t.paid, r.currency)}</td>
              <td>{money(t.share, r.currency)}</td>
              <td>{money(t.before, r.currency)}</td>
              <td>{money(t.settled, r.currency)}</td>
              <td>{money(t.balance, r.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <MembersCards c={c} who={who} t={t} />
    </section>
  );
}

/** Телефон: та же таблица карточками — по строке на участника и сверка в конце. */
function MembersCards({ c, who, t }: { c: Ctx; who: (m: ReportMemberDto) => string; t: ReturnType<typeof totals> }) {
  const cur = c.r.currency;
  return (
    <div className="card list report-cards mobile-only">
      {c.r.members.map((m) => (
        <div key={m.userId} className="report-card">
          <div className="report-card__head">
            <span>{who(m)}</span>
            <span className={`n report-table__total ${signClass(m.balance)}`}>{signed(m.balance, cur)}</span>
          </div>
          <dl className="report-card__grid n">
            <dt>Заплатил</dt>
            <dd>{money(m.paid, cur)}</dd>
            <dt>Его доля</dt>
            <dd>{money(m.share, cur)}</dd>
            <dt>Баланс до расчёта</dt>
            <dd className={signClass(m.paid - m.share)}>{signed(m.paid - m.share, cur)}</dd>
            <dt>Погашения</dt>
            <dd>{settledText(c, m)}</dd>
          </dl>
        </div>
      ))}
      <div className="report-card report-card--sum">
        <div className="report-card__head">
          <span>Сверка</span>
          <span className="n">{money(t.balance, cur)}</span>
        </div>
        <dl className="report-card__grid n">
          <dt>Заплатили</dt>
          <dd>{money(t.paid, cur)}</dd>
          <dt>Доли</dt>
          <dd>{money(t.share, cur)}</dd>
          <dt>Балансы до расчёта</dt>
          <dd>{money(t.before, cur)}</dd>
          <dt>Погашения</dt>
          <dd>{money(t.settled, cur)}</dd>
        </dl>
      </div>
    </div>
  );
}

// ---------- Погашения, остатки, расходы ----------

function SettlementPill({ s, currency }: { s: SettlementDto; currency: string }) {
  const confirmed = s.status === 'confirmed';
  return (
    <span className={`pill report-pill ${confirmed ? 'pill--done' : 'pill--pending'}`} title={confirmed ? 'подтверждено' : 'ждёт подтверждения'}>
      <Icon name={confirmed ? 'check' : 'clock'} size={13} strokeWidth={2.4} />
      {money(s.amount, currency)}
    </span>
  );
}

function SettlementsList(c: Ctx) {
  const { r } = c;
  if (r.settlements.length === 0) return null;
  const done = r.settlements.filter((s) => s.status === 'confirmed').length;
  return (
    <section className="report-section">
      <h2 className="report-section__title">
        Погашения, {done} из {r.settlements.length} {plural(done, 'подтверждено', 'подтверждены', 'подтверждены')}
      </h2>
      <div className="card list">
        {r.settlements.map((s) => (
          <div key={s.id} className="report-line n">
            <span>
              {nameOf(c, s.fromId)} → {nameOf(c, s.toId)}
            </span>
            <SettlementPill s={s} currency={r.currency} />
          </div>
        ))}
      </div>
      {done < r.settlements.length && <p className="hint-sm">Пунктир — ещё ждёт подтверждения и в итог не вошло.</p>}
    </section>
  );
}

function TransfersLeft(c: Ctx) {
  const { r } = c;
  return (
    <section className="report-section">
      <h2 className="report-section__title">Осталось перевести</h2>
      <div className="card list">
        {r.transfers.map((t) => (
          <div key={`${t.fromId}:${t.toId}`} className="report-line n">
            <span>
              {nameOf(c, t.fromId)} → {nameOf(c, t.toId)}
            </span>
            <strong>{money(t.amount, r.currency)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExpensesList({ c, expenses }: { c: Ctx; expenses: ExpenseDto[] }) {
  if (expenses.length === 0) return null;
  return (
    <section className="report-section">
      <h2 className="report-section__title">
        Расходы
      </h2>
      <div className="card list">
        {expenses.map((e) => (
          <div key={e.id} className="report-line">
            <span className="report-line__main">
              {e.title || CATEGORY_LABELS[e.category]}
              <span className="report-line__meta">
                {nameOf(c, e.payerId)} · {splitLabel(e, c.g.memberCount)}
                {e.receipt && (
                  <>
                    {' · '}
                    <ReceiptMark expenseId={e.id} />
                  </>
                )}
              </span>
            </span>
            <span className="n">{money(e.amount, c.r.currency)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
