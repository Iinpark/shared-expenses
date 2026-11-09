import type { GroupDto } from '@se/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { copy, fill } from '../lib/copy.js';
import { errorText, useReopenGroup } from '../lib/queries/index.js';
import { dayMonth } from '../lib/ru.js';
import { Icon } from './Icon.js';
import { useToast } from './Toast.js';

/**
 * Banner закрытой группы (S03, D05): тёмная плашка «Группа закрыта 4 января. Только просмотр.»
 * Создателю — «Открыть снова» с подтверждением на месте, остальным — ничего, кроме ссылки на итог.
 */
export function ClosedBanner({ g, isOwner, reportLink = false }: { g: GroupDto; isOwner: boolean; reportLink?: boolean }) {
  const [asking, setAsking] = useState(false);
  const reopen = useReopenGroup(g.id);
  const toast = useToast();
  // Плашка пропадает вместе с закрытием, поэтому mutateAsync: колбэки mutate у размонтированного компонента не вызываются.
  const run = () => {
    reopen.mutateAsync().then(
      () => {
        toast('Группа снова открыта');
      },
      () => undefined,
    );
  };
  const text = asking ? 'Открыть группу снова? Расходы и погашения снова можно будет добавлять и менять.' : fill(copy.group.closedBanner, { date: g.closedAt ? dayMonth(g.closedAt) : '' });
  return (
    <div className="banner banner--closed" role="status">
      <div className="banner__inner">
        <Icon name="lock" size={18} />
        <span className="banner__text">
          {text}
          {reopen.error && <span className="banner__error">{errorText(reopen.error)}</span>}
        </span>
        <span className="banner__actions">
          {reportLink && !asking && (
            <Link to={`/groups/${g.id}/report`} className="banner__link">
              Итог
            </Link>
          )}
          {isOwner && !asking && (
            <button
              type="button"
              className="btn btn--sm banner__btn"
              onClick={() => {
                setAsking(true);
              }}
            >
              {copy.group.reopen}
            </button>
          )}
          {asking && (
            <>
              <button type="button" className="btn btn--sm banner__btn banner__btn--solid" disabled={reopen.isPending} onClick={run}>
                Открыть
              </button>
              <button
                type="button"
                className="btn btn--sm banner__btn"
                disabled={reopen.isPending}
                onClick={() => {
                  setAsking(false);
                }}
              >
                Отмена
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
