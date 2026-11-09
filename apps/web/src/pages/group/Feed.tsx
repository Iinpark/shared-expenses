import { byGender, type ExpenseSnapshot, type Gender, type GroupDto, type GroupEventDto, type GroupEventPayload, type SettlementStatus } from '@se/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.js';
import {
  balanceDeltas,
  clock,
  expenseVerb,
  involves,
  isExpenseEvent,
  isSettlementEvent,
  latest,
  memberOf,
  settlementPath,
  snapshotTitle,
  type ExpensePayload,
  type SettlementPayload,
} from '../../lib/events.js';
import { money, shortDate } from '../../lib/format.js';
import { errorText, useGroupFeed, useSettlements } from '../../lib/queries/index.js';
import { dayMonth, joinNames, plural } from '../../lib/ru.js';

/** M03: лента группы. События от новых к старым, новые приходят сверху сами (реалтайм инвалидирует запрос). */

type Filter = 'all' | 'expenses' | 'settlements' | 'mine' | 'group';
const FILTERS: [Filter, string][] = [
  ['all', 'Всё'],
  ['expenses', 'Расходы'],
  ['settlements', 'Погашения'],
  ['mine', 'Со мной'],
  ['group', 'Группа'],
];

/** Касается ли событие человека: его расход или погашение, где он отдаёт или получает. */
function concerns(p: GroupEventPayload, meId: string): boolean {
  if (isExpenseEvent(p)) return involves(p, meId);
  if (isSettlementEvent(p)) return p.settlement.fromId === meId || p.settlement.toId === meId;
  return false;
}

function matches(filter: Filter, p: GroupEventPayload, meId: string): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'expenses':
      return isExpenseEvent(p);
    case 'settlements':
      return isSettlementEvent(p);
    case 'mine':
      return concerns(p, meId);
    case 'group':
      return !isExpenseEvent(p) && !isSettlementEvent(p);
  }
}

interface RowCtx {
  g: GroupDto;
  meId: string;
  meGender: Gender | null;
  /** Текущий статус погашений по id: у отметки в ленте видно, чем всё кончилось. */
  statuses: ReadonlyMap<string, SettlementStatus>;
}

// ---------- Что было в ленте раньше: подсветка новых чужих событий ----------

const seenKey = (groupId: string) => `se:feed-seen:${groupId}`;

function readSeen(groupId: string): string | null {
  try {
    return localStorage.getItem(seenKey(groupId));
  } catch {
    return null;
  }
}

function writeSeen(groupId: string, createdAt: string) {
  try {
    localStorage.setItem(seenKey(groupId), createdAt);
  } catch {
    // Без хранилища просто не будет подсветки при следующем визите.
  }
}

// ---------- Даты ----------

const localDay = (iso: string) => new Date(iso).toDateString();

function dayTitle(iso: string): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (localDay(iso) === now.toDateString()) return `Сегодня, ${dayMonth(iso)}`;
  if (localDay(iso) === yesterday.toDateString()) return `Вчера, ${dayMonth(iso)}`;
  return dayMonth(iso);
}

function byDay(events: GroupEventDto[]): { day: string; events: GroupEventDto[] }[] {
  const days: { day: string; events: GroupEventDto[] }[] = [];
  for (const e of events) {
    const last = days.at(-1);
    if (last && localDay(last.day) === localDay(e.createdAt)) last.events.push(e);
    else days.push({ day: e.createdAt, events: [e] });
  }
  return days;
}

// ---------- Предложения ----------

/** Кто сделал: «Ты» или имя, и пол — для глагола. */
function actorOf(c: RowCtx, e: GroupEventDto): { name: string; gender: Gender | null } {
  if (e.actorId === c.meId) return { name: 'Ты', gender: c.meGender };
  return { name: e.actorName, gender: memberOf(c.g, e.actorId)?.gender ?? null };
}

const nameIn = (c: RowCtx, id: string) => (id === c.meId ? 'ты' : (memberOf(c.g, id)?.name ?? 'бывший участник'));

function sharesText(c: RowCtx, s: ExpenseSnapshot): string {
  const share = s.shares.find((x) => x.userId === c.meId);
  const who = s.shares.length === c.g.memberCount ? `на всех ${String(s.shares.length)}` : joinNames(s.shares.map((x) => nameIn(c, x.userId)));
  return `${who} · ${share ? `твоя доля ${money(share.amount, c.g.currency)}` : 'без тебя'}`;
}

function myBalanceLine(c: RowCtx, p: ExpensePayload): ReactNode {
  if (!involves(p, c.meId)) return null;
  const mine = balanceDeltas(p).get(c.meId) ?? 0;
  return (
    <span className="feed-row__meta">
      Твой баланс: {mine === 0 ? 'не изменился' : <span className="n">{money(mine, c.g.currency, true)}</span>}
    </span>
  );
}

const sameShares = (a: ExpenseSnapshot, b: ExpenseSnapshot) =>
  a.shares.length === b.shares.length && a.shares.every((s, i) => s.userId === b.shares[i]?.userId && s.amount === b.shares[i].amount);

function Was({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <span className="feed-row__change">
      {label} <s className="struck">{from}</s> → <strong>{to}</strong>
    </span>
  );
}

function UpdateDetails({ c, before, after }: { c: RowCtx; before: ExpenseSnapshot; after: ExpenseSnapshot }) {
  return (
    <>
      {before.amount !== after.amount && <Was label="Сумма" from={money(before.amount, c.g.currency)} to={money(after.amount, c.g.currency)} />}
      {snapshotTitle(before) !== snapshotTitle(after) && <Was label="Название" from={`«${snapshotTitle(before)}»`} to={`«${snapshotTitle(after)}»`} />}
      {before.payerId !== after.payerId && <Was label="Платил" from={nameIn(c, before.payerId)} to={nameIn(c, after.payerId)} />}
      {before.spentOn !== after.spentOn && <Was label="Дата" from={shortDate(before.spentOn)} to={shortDate(after.spentOn)} />}
      {before.amount === after.amount && !sameShares(before, after) && <span className="feed-row__change">Деление: {sharesText(c, after)}</span>}
    </>
  );
}

function ExpenseRow({ c, e, p }: { c: RowCtx; e: GroupEventDto; p: ExpensePayload }) {
  const actor = actorOf(c, e);
  const head = (
    <>
      <strong>{actor.name}</strong> {expenseVerb(p.type, actor.gender)} «{snapshotTitle(latest(p))}»
    </>
  );
  switch (p.type) {
    case 'expense_created':
      return <Row head={head} side={<span className="n">{money(p.after.amount, c.g.currency)}</span>} meta={sharesText(c, p.after)} time={e.createdAt} />;
    case 'expense_deleted':
      return <Row head={head} side={<s className="n struck">{money(p.before.amount, c.g.currency)}</s>} extra={myBalanceLine(c, p)} time={e.createdAt} />;
    case 'expense_updated':
      return (
        <Row
          head={head}
          extra={
            <>
              <UpdateDetails c={c} before={p.before} after={p.after} />
              {myBalanceLine(c, p)}
            </>
          }
          time={e.createdAt}
        />
      );
  }
}

// ---------- Погашения ----------

const SETTLEMENT_VERBS: Record<SettlementPayload['type'], [string, string, string]> = {
  settlement_created: ['отметил', 'отметила', 'перевод'],
  settlement_confirmed: ['подтвердил', 'подтвердила', 'перевод'],
  settlement_rejected: ['отметил', 'отметила', ', что деньги не пришли'],
  settlement_cancelled: ['отменил', 'отменила', 'отметку о переводе'],
};

/** «Гена → тебе», «ты → Аня»: имена без склонения. */
function pairText(c: RowCtx, fromId: string, toId: string): string {
  const to = toId === c.meId ? 'тебе' : nameIn(c, toId);
  return `${nameIn(c, fromId)} → ${to}`;
}

/** StatusPill под отметкой: пунктир — ждёт, заливка — подтверждено, обводка — не пришли. */
function StatusPill({ c, p }: { c: RowCtx; p: SettlementPayload }) {
  const status = c.statuses.get(p.settlement.id);
  const forMe = p.settlement.toId === c.meId;
  switch (status) {
    case 'pending':
      return forMe ? (
        <Link to={settlementPath(c.g.id, p.settlement.id)} className="pill pill--pending feed-pill">
          <Icon name="clock" size={12} /> ждёт твоего подтверждения
        </Link>
      ) : (
        <span className="pill pill--pending feed-pill">
          <Icon name="clock" size={12} /> ждёт подтверждения
        </span>
      );
    case 'confirmed':
      return (
        <span className="pill pill--done feed-pill">
          <Icon name="check" size={12} /> подтверждено · учтено в балансе
        </span>
      );
    case 'rejected':
      return <span className="pill pill--rejected feed-pill">деньги не пришли</span>;
    case 'cancelled':
      return <span className="pill feed-pill">отметка отменена</span>;
    case undefined:
      return null;
  }
}

function SettlementRow({ c, e, p }: { c: RowCtx; e: GroupEventDto; p: SettlementPayload }) {
  const actor = actorOf(c, e);
  const [m, f, what] = SETTLEMENT_VERBS[p.type];
  const head = (
    <>
      <strong>{actor.name}</strong> {byGender(actor.gender, m, f)}
      {what.startsWith(',') ? what : ` ${what}`}
    </>
  );
  const amount = money(p.settlement.amount, c.g.currency);
  const struck = p.type === 'settlement_rejected' || p.type === 'settlement_cancelled';
  return (
    <Row
      head={head}
      side={struck ? <s className="n struck">{amount}</s> : <span className="n">{amount}</span>}
      meta={pairText(c, p.settlement.fromId, p.settlement.toId)}
      extra={
        <>
          {p.settlement.comment && <span className="feed-row__meta">«{p.settlement.comment}»</span>}
          {p.type === 'settlement_created' && <StatusPill c={c} p={p} />}
        </>
      }
      time={e.createdAt}
    />
  );
}

const reminderText = (v: string | number) => `${String(v)} ${plural(Number(v), 'день', 'дня', 'дней')}`;

function GroupChange({ change }: { change: Extract<GroupEventPayload, { type: 'group_updated' }>['changes'][number] }) {
  switch (change.field) {
    case 'name':
      return <Was label="Название" from={`«${String(change.from)}»`} to={`«${String(change.to)}»`} />;
    case 'currency':
      return <Was label="Валюта" from={String(change.from)} to={String(change.to)} />;
    case 'reminderDays':
      return <Was label="Напоминание через" from={reminderText(change.from)} to={reminderText(change.to)} />;
  }
}

function GroupRow({ c, e, p }: { c: RowCtx; e: GroupEventDto; p: Extract<GroupEventPayload, { type: 'member_joined' | 'group_updated' }> }) {
  if (p.type === 'member_joined') {
    const self = p.userId === c.meId;
    const gender = self ? c.meGender : (memberOf(c.g, p.userId)?.gender ?? null);
    const head = (
      <>
        <strong>{self ? 'Ты' : p.name}</strong> {byGender(gender, 'вступил', 'вступила')} в группу
      </>
    );
    return <Row head={head} time={e.createdAt} />;
  }
  const actor = actorOf(c, e);
  const only = p.changes.length === 1 ? p.changes[0] : undefined;
  const what = only?.field === 'name' ? byGender(actor.gender, 'переименовал', 'переименовала') + ' группу' : byGender(actor.gender, 'изменил', 'изменила') + ' настройки группы';
  const head = (
    <>
      <strong>{actor.name}</strong> {what}
    </>
  );
  return (
    <Row
      head={head}
      extra={p.changes.map((ch) => (
        <GroupChange key={ch.field} change={ch} />
      ))}
      time={e.createdAt}
    />
  );
}

function Row(p: { head: ReactNode; side?: ReactNode; meta?: string; extra?: ReactNode; time: string }) {
  return (
    <>
      <div className="feed-row__top">
        <span className="feed-row__head">{p.head}</span>
        <span className="feed-row__side">{p.side ?? <span className="feed-row__time">{clock(p.time)}</span>}</span>
      </div>
      {(p.meta ?? p.side) && <span className="feed-row__meta">{[p.meta, p.side ? clock(p.time) : null].filter(Boolean).join(' · ')}</span>}
      {p.extra}
    </>
  );
}

function EventBody({ c, e }: { c: RowCtx; e: GroupEventDto }) {
  const p = e.payload;
  if (isExpenseEvent(p)) return <ExpenseRow c={c} e={e} p={p} />;
  if (isSettlementEvent(p)) return <SettlementRow c={c} e={e} p={p} />;
  return <GroupRow c={c} e={e} p={p} />;
}

function EventRow({ c, e, fresh }: { c: RowCtx; e: GroupEventDto; fresh: boolean }) {
  return (
    <li className={`feed-row${fresh ? ' changed-row' : ''}`}>
      <EventBody c={c} e={e} />
    </li>
  );
}

// ---------- Экран ----------

function Filters({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  return (
    <div className="feed-filters" role="group" aria-label="Что показывать">
      {FILTERS.map(([f, label]) => (
        <button
          key={f}
          type="button"
          className="filter-chip"
          aria-pressed={value === f}
          onClick={() => {
            onChange(f);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Days({ c, events, isFresh }: { c: RowCtx; events: GroupEventDto[]; isFresh: (e: GroupEventDto) => boolean }) {
  return byDay(events).map((d) => (
    <div key={d.day} className="feed-day">
      <h3 className="feed-day__title">{dayTitle(d.day)}</h3>
      <ul className="feed-list">
        {d.events.map((e) => (
          <EventRow key={e.id} c={c} e={e} fresh={isFresh(e)} />
        ))}
      </ul>
    </div>
  ));
}

/** Время последнего события, которое человек уже видел в ленте этой группы, — с прошлого визита. */
function useSeenAt(groupId: string, newest: string | undefined) {
  // Первый визит: подсвечиваем то, что придёт, пока лента открыта.
  const [seenAt] = useState(() => readSeen(groupId) ?? new Date().toISOString());
  useEffect(() => {
    if (newest) writeSeen(groupId, newest);
  }, [groupId, newest]);
  return seenAt;
}

type Feed = ReturnType<typeof useGroupFeed>;

function FeedStatus({ feed, empty }: { feed: Feed; empty: boolean }) {
  if (feed.isPending) return <p className="hint feed-note">Загружаем…</p>;
  if (feed.error) return <p className="form-error feed-note">{errorText(feed.error)}</p>;
  return empty ? <p className="hint feed-note">Здесь пока ничего нет.</p> : null;
}

/** «Показать ещё»: следующая страница с курсором nextBefore. */
function MoreButton({ feed }: { feed: Feed }) {
  if (!feed.hasNextPage) return null;
  return (
    <button type="button" className="btn btn--outline feed-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
      {feed.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
    </button>
  );
}

export function FeedPanel({ g, meId }: { g: GroupDto; meId: string }) {
  const feed = useGroupFeed(g.id);
  const settlements = useSettlements(g.id);
  const [filter, setFilter] = useState<Filter>('all');
  const events = feed.data?.pages.flatMap((p) => p.events) ?? [];
  const seenAt = useSeenAt(g.id, events[0]?.createdAt);

  const statuses = new Map((settlements.data ?? []).map((s) => [s.id, s.status]));
  const c: RowCtx = { g, meId, meGender: memberOf(g, meId)?.gender ?? null, statuses };
  const shown = events.filter((e) => matches(filter, e.payload, meId));
  const isFresh = (e: GroupEventDto) => e.actorId !== meId && e.createdAt > seenAt;

  return (
    <section className="feed">
      <Filters value={filter} onChange={setFilter} />
      <FeedStatus feed={feed} empty={shown.length === 0} />
      <Days c={c} events={shown} isFresh={isFresh} />
      <MoreButton feed={feed} />
    </section>
  );
}
