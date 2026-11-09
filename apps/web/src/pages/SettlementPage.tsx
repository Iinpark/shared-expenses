import { byGender, type BalancesDto, type GroupDto, type SettlementDto } from '@se/shared';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { copy, fill } from '../lib/copy.js';
import { clock, memberOf } from '../lib/events.js';
import { money, moneyCur } from '../lib/format.js';
import { errorText, useBalances, useCurrentUser, useDecideSettlement, useGroup, useSettlements, type SettlementDecision } from '../lib/queries/index.js';
import { dayMonth } from '../lib/ru.js';
import { balanceOf, previewConfirm, transferAmount } from '../lib/settlements.js';
import { NotFoundPage } from './NotFoundPage.js';

interface Ctx {
  g: GroupDto;
  s: SettlementDto;
  meId: string;
  balances: BalancesDto;
}

const nameOf = (g: GroupDto, id: string) => memberOf(g, id)?.name ?? 'Бывший участник';
const verb = (g: GroupDto, id: string, m: string, f: string) => byGender(memberOf(g, id)?.gender, m, f);

/** M08: погашение. Получатель подтверждает или отклоняет, должник может отменить свою отметку. */
export function SettlementPage() {
  const { id = '', settlementId = '' } = useParams();
  const group = useGroup(id);
  const balances = useBalances(id);
  const settlements = useSettlements(id);
  const me = useCurrentUser();
  if (group.error || settlements.error) return <NotFoundPage />;
  if (!group.data || !balances.data || !settlements.data) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  const s = settlements.data.find((x) => x.id === settlementId);
  if (!s) return <NotFoundPage />;
  return <SettlementView c={{ g: group.data, s, meId: me.id, balances: balances.data }} />;
}

function title({ g, s, meId }: Ctx): string {
  const from = nameOf(g, s.fromId);
  if (s.toId === meId) return `${from} ${verb(g, s.fromId, 'отметил', 'отметила')}, что ${verb(g, s.fromId, 'перевёл', 'перевела')} тебе`;
  if (s.fromId === meId) return `Ты ${verb(g, meId, 'отметил', 'отметила')} перевод → ${nameOf(g, s.toId)}`;
  return `${from} ${verb(g, s.fromId, 'отметил', 'отметила')} перевод → ${nameOf(g, s.toId)}`;
}

const STATUS_TEXT: Record<SettlementDto['status'], string> = {
  pending: 'пока не учтено в балансе',
  confirmed: 'подтверждено · учтено в балансе',
  rejected: 'деньги не пришли · не учтено в балансе',
  cancelled: 'отметка отменена',
};

function SettlementView({ c }: { c: Ctx }) {
  const { g, s } = c;
  const meta = `${dayMonth(s.createdAt)}, ${clock(s.createdAt)} · ${STATUS_TEXT[s.status]}`;
  return (
    <div className="page page--white form-page settle-page">
      <header className="sheet-head">
        <Link to={`/groups/${g.id}`} aria-label="Назад к группе" className="icon-btn">
          <Icon name="back" size={24} />
        </Link>
        <span className="sheet-head__title">Погашение</span>
      </header>
      <section className="settle-page__head">
        <h1 className="settle-page__title">{title(c)}</h1>
        <p className="n settle-page__amount">{moneyCur(s.amount, g.currency)}</p>
        <p className="settle-page__meta">{meta}</p>
      </section>
      {s.comment && (
        <blockquote className="settle-page__comment">
          <span className="settle-page__comment-label">{nameOf(g, s.fromId)} пишет</span>
          {s.comment}
        </blockquote>
      )}
      {s.status === 'pending' && s.toId === c.meId && <IfConfirm c={c} />}
      <Actions c={c} />
    </div>
  );
}

/** Строка «было → станет». */
function Was({ label, from, to, currency, cls = '' }: { label: string; from: number; to: number; currency: string; cls?: string }) {
  return (
    <>
      <span className="text-2">{label}</span>
      <span className={cls}>{money(from, currency)}</span>
      <span className="settle-page__arrow">→</span>
      <strong className={cls}>{money(to, currency)}</strong>
    </>
  );
}

function IfConfirm({ c }: { c: Ctx }) {
  const { g, s, meId, balances } = c;
  const after = previewConfirm(balances, s);
  const mine = balanceOf(balances, meId);
  const mineAfter = balanceOf(after, meId);
  return (
    <section className="settle-page__if">
      <h2 className="settle-page__if-title">{copy.settlement.ifConfirm}</h2>
      <div className="n settle-page__grid">
        <Was label={`${nameOf(g, s.fromId)} вернёт тебе`} from={transferAmount(balances, s.fromId, meId)} to={transferAmount(after, s.fromId, meId)} currency={g.currency} />
        {mine >= 0 && mineAfter >= 0 ? (
          <Was label="Тебе вернут всего" from={mine} to={mineAfter} currency={g.currency} cls="plus" />
        ) : (
          <Was label="Твой баланс" from={mine} to={mineAfter} currency={g.currency} />
        )}
      </div>
    </section>
  );
}

const DONE: Record<SettlementDecision, string> = {
  confirm: 'Перевод подтверждён. Баланс обновился.',
  reject: 'Отметили, что деньги не пришли.',
  cancel: 'Отметка отменена.',
};

function Actions({ c }: { c: Ctx }) {
  const { g, s, meId } = c;
  const decide = useDecideSettlement(g.id);
  const toast = useToast();
  const navigate = useNavigate();
  const run = (action: SettlementDecision) => {
    decide.mutate(
      { id: s.id, action },
      {
        onSuccess: () => {
          toast(DONE[action]);
          void navigate(`/groups/${g.id}`);
        },
      },
    );
  };
  const open = g.status === 'open' && s.status === 'pending';
  return (
    <div className="settle-page__foot">
      {decide.error && (
        <p className="form-error" role="alert">
          {errorText(decide.error)}
        </p>
      )}
      {open && s.toId === meId && (
        <>
          <button
            type="button"
            className="btn btn--primary btn--main"
            disabled={decide.isPending}
            onClick={() => {
              run('confirm');
            }}
          >
            <Icon name="check" size={20} strokeWidth={2.2} />
            {copy.settlement.yes}
          </button>
          <button
            type="button"
            className="btn btn--main"
            disabled={decide.isPending}
            onClick={() => {
              run('reject');
            }}
          >
            {copy.settlement.no}
          </button>
          <p className="hint-sm settle-page__hint">{fill(copy.settlement.rejectHint, { name: nameOf(g, s.fromId) })}</p>
        </>
      )}
      {open && s.fromId === meId && (
        <button
          type="button"
          className="btn btn--main"
          disabled={decide.isPending}
          onClick={() => {
            run('cancel');
          }}
        >
          {copy.settlement.cancelMark}
        </button>
      )}
      {g.status === 'closed' && s.status === 'pending' && <p className="hint-sm settle-page__hint">Группа закрыта. Подтвердить или отменить перевод можно, когда её откроют снова.</p>}
      {!open && (
        <Link to={`/groups/${g.id}`} className="btn btn--main">
          К группе
        </Link>
      )}
    </div>
  );
}
