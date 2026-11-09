import { byGender, expenseEffect, type ExpenseDto, type Gender, type GroupDto, type GroupEventDto, type LedgerExpense } from '@se/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { copy } from '../../lib/copy.js';
import { actorGender, clock, expenseVerb, isExpenseEvent, latest, snapshotTitle } from '../../lib/events.js';
import { CATEGORY_LABELS, money, shortDate } from '../../lib/format.js';
import { useGroupEventListener, type ConflictAction } from '../../lib/queries/index.js';

const nameIn = (g: GroupDto, id: string) => g.members.find((m) => m.userId === id)?.name ?? 'Бывший участник';
const signClass = (v: number) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');

/** D03: как изменятся балансы после сохранения правки. Текущие балансы − старый расход + новый. */
export function EditPreview(p: { g: GroupDto; meId: string; before: { userId: string; amount: number }[]; oldExpense: ExpenseDto; newExpense: LedgerExpense }) {
  const oldEffect = expenseEffect(p.oldExpense);
  const newEffect = expenseEffect(p.newExpense);
  const rows = p.before.map((b) => ({ ...b, after: b.amount - (oldEffect.get(b.userId) ?? 0) + (newEffect.get(b.userId) ?? 0) }));
  if (rows.every((r) => r.after === r.amount)) return null;
  return (
    <div className="preview">
      <p style={{ fontWeight: 600 }}>{copy.expense.editPreviewTitle}</p>
      <table>
        <thead>
          <tr>
            <th>Участник</th>
            <th className="num">Сейчас</th>
            <th className="num">Станет</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PreviewRow key={r.userId} g={p.g} isMe={r.userId === p.meId} userId={r.userId} now={r.amount} after={r.after} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewRow(p: { g: GroupDto; isMe: boolean; userId: string; now: number; after: number }) {
  const same = p.after === p.now;
  const name = nameIn(p.g, p.userId);
  return (
    <tr style={p.isMe ? { fontWeight: 600 } : undefined}>
      <td>{p.isMe ? `Ты (${name})` : name}</td>
      <td className="num n">{money(p.now, p.g.currency, true)}</td>
      {same ? (
        <td className="num n text-2" style={{ fontWeight: 400 }}>
          без изменений
        </td>
      ) : (
        <td className={`num n ${signClass(p.after)}`} style={{ fontWeight: 600 }}>
          {money(p.after, p.g.currency, true)}
        </td>
      )}
    </tr>
  );
}

// ---------- FormNotice (S03): данные поменялись, пока заполняешь форму ----------

/** Хвост текста из copy: «Твою форму это не затронет, балансы обновятся после сохранения.» */
const NOTICE_TAIL = copy.live.formNotice.slice(copy.live.formNotice.indexOf('». ') + 3);

/** Группу закрыли, пока форма открыта: сохранить не выйдет (сервер ответит 409), но набранное не теряем. */
const CLOSED_TAIL = 'Сохранить не получится, пока её не откроют снова. Набранное останется в форме.';
const CLOSED_NOTICE = `Группу закрыли. ${CLOSED_TAIL}`;

interface Notice {
  text: string;
  /** Новость про этот же расход или про всю группу: её не перебивают новости о других расходах. */
  same: boolean;
}

function statusNotice(event: GroupEventDto, g: GroupDto, closed: boolean): Notice {
  const gender = actorGender(g, event);
  const text = closed
    ? `${event.actorName} ${byGender(gender, 'закрыл', 'закрыла')} группу. ${CLOSED_TAIL}`
    : `${event.actorName} ${byGender(gender, 'открыл', 'открыла')} группу снова. Можно сохранять.`;
  return { text, same: true };
}

function noticeText(event: GroupEventDto, g: GroupDto, expenseId: string | undefined): Notice | null {
  const p = event.payload;
  if (p.type === 'group_closed' || p.type === 'group_reopened') return statusNotice(event, g, p.type === 'group_closed');
  if (!isExpenseEvent(p)) return null;
  const verb = expenseVerb(p.type, actorGender(g, event));
  const same = latest(p).id === expenseId;
  if (!same) return { text: `${event.actorName} ${verb} «${snapshotTitle(latest(p))}». ${NOTICE_TAIL}`, same };
  const tail = p.type === 'expense_deleted' ? 'Сохранить правку уже не получится.' : 'Твою форму это не затронет, при сохранении покажем обе версии.';
  return { text: `${event.actorName} ${verb} этот расход. ${tail}`, same };
}

/**
 * Тихая строка над формой, когда в группе что-то поменяли другие. Поля формы не трогаем.
 * Новость про этот же расход важнее остальных и не перебивается ими.
 */
export function useFormNotice(g: GroupDto, meId: string, expenseId: string | undefined) {
  const [notice, setNotice] = useState<Notice | null>(null);
  useGroupEventListener((event) => {
    if (event.groupId !== g.id || event.actorId === meId) return;
    const next = noticeText(event, g, expenseId);
    if (next && (next.same || !notice?.same)) setNotice(next);
  });
  // Группа закрыта, а события мы не видели (например, после переподключения): объясняем сами.
  if (g.status === 'closed' && !notice?.text.includes(CLOSED_TAIL)) return CLOSED_NOTICE;
  return notice?.text ?? null;
}

export function FormNotice({ text }: { text: string }) {
  return (
    <div className="form-notice" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

// ---------- ConflictSheet (S03): расход изменили, пока его правили ----------

/** Версия расхода для карточки: из базы или из несохранённой формы. */
export interface VersionView {
  title: string;
  amount: number;
  payerId: string;
  shareIds: string[];
  spentOn: string;
}

const versionOf = (e: ExpenseDto): VersionView => ({
  title: e.title || CATEGORY_LABELS[e.category],
  amount: e.amount,
  payerId: e.payerId,
  shareIds: e.shares.map((s) => s.userId),
  spentOn: e.spentOn,
});

function VersionCard(p: { g: GroupDto; v: VersionView | null; other: VersionView | null; caption: string; label: string }) {
  const { g, v, other } = p;
  const differs = (cond: boolean) => (other && cond ? 'conflict-card__diff' : undefined);
  return (
    <figure className="conflict-version">
      <div className="conflict-card">
        {v ? (
          <>
            <span className={`conflict-card__title ${differs(v.title !== other?.title) ?? ''}`}>{v.title}</span>
            <span className={`n conflict-card__amount ${differs(v.amount !== other?.amount) ?? ''}`}>{money(v.amount, g.currency)}</span>
            <span className="conflict-card__meta">
              платил <span className={differs(v.payerId !== other?.payerId)}>{nameIn(g, v.payerId)}</span>
            </span>
            <span className="conflict-card__meta">
              {v.shareIds.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <span className={differs(!other?.shareIds.includes(id))}>{nameIn(g, id)}</span>
                </span>
              ))}
            </span>
            <span className={`conflict-card__meta ${differs(v.spentOn !== other?.spentOn) ?? ''}`}>{shortDate(v.spentOn)}</span>
          </>
        ) : (
          <span className="conflict-card__title">Удалить расход</span>
        )}
      </div>
      <figcaption className="conflict-version__caption">
        <strong>{p.label}</strong>
        <br />
        {p.caption}
      </figcaption>
    </figure>
  );
}

interface ConflictProps {
  g: GroupDto;
  current: ExpenseDto | null;
  meId: string;
  meGender: Gender | null;
  busy: boolean;
  action: ConflictAction;
  /** Несохранённая форма; null — человек удалял расход. */
  mine: VersionView | null;
  onApply: () => void;
}

function conflictTitle(p: ConflictProps, current: ExpenseDto): string {
  const editing = byGender(p.meGender, 'правил', 'правила');
  if (current.updatedBy === p.meId) return `Пока ты ${editing}, этот расход изменили в другой вкладке`;
  const author = p.g.members.find((m) => m.userId === current.updatedBy);
  return `Пока ты ${editing}, ${author?.name ?? 'кто-то'} ${byGender(author?.gender, 'изменил', 'изменила')} этот расход`;
}

/**
 * ConflictSheet: сохранение вернуло 409. Две зеркальные карточки — как сейчас в базе и как в твоей форме,
 * и выбор: применить свою правку поверх свежей версии или оставить как есть.
 */
export function ConflictSheet(p: ConflictProps) {
  const { g, current } = p;
  return (
    <div className="sheet-overlay">
      <section role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" className="conflict-sheet">
        {current ? <ConflictBody {...p} current={current} /> : <DeletedBody g={g} meGender={p.meGender} />}
      </section>
    </div>
  );
}

function ConflictBody(p: ConflictProps & { current: ExpenseDto }) {
  const { g, current } = p;
  const theirs = versionOf(current);
  const author = g.members.find((m) => m.userId === current.updatedBy);
  const saved = current.updatedBy === p.meId ? `так сохранено в другой вкладке, ${clock(current.updatedAt)}` : `так ${byGender(author?.gender, 'сохранил', 'сохранила')} ${author?.name ?? 'кто-то'}, ${clock(current.updatedAt)}`;
  return (
    <>
      <h2 id="conflict-title" className="conflict-sheet__title">
        {conflictTitle(p, current)}
      </h2>
      <div className="conflict-versions">
        <VersionCard g={g} v={theirs} other={p.mine} label="Сейчас" caption={saved} />
        <VersionCard g={g} v={p.mine} other={theirs} label="Твоя правка" caption={copy.live.conflictMine} />
      </div>
      <button type="button" className="btn btn--primary conflict-sheet__btn" disabled={p.busy} onClick={p.onApply}>
        {p.action === 'delete' ? 'Всё равно удалить' : copy.live.conflictApply}
      </button>
      <Link to={`/groups/${g.id}`} className="btn btn--outline conflict-sheet__btn">
        Оставить как есть
      </Link>
    </>
  );
}

function DeletedBody({ g, meGender }: { g: GroupDto; meGender: Gender | null }) {
  return (
    <>
      <h2 id="conflict-title" className="conflict-sheet__title">
        Пока ты {byGender(meGender, 'правил', 'правила')}, этот расход удалили
      </h2>
      <p className="text-2">Сохранить правку не получится. Если расход нужен, добавь его заново.</p>
      <Link to={`/groups/${g.id}`} className="btn btn--primary conflict-sheet__btn">
        К группе
      </Link>
    </>
  );
}
