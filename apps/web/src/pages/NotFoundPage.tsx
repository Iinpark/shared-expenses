import { Link } from 'react-router';
import { copy } from '../lib/copy.js';

/** M11: страница 404. */
export function NotFoundPage() {
  return (
    <div className="solo">
      <p className="solo__brand">Совместные расходы</p>
      <section className="solo__body solo__body--center">
        <p className="hint" style={{ fontSize: 15 }}>
          Ошибка 404
        </p>
        <h1 className="big-title">{copy.fun.notFoundTitle}</h1>
        <p className="lead">{copy.errors.notFoundText}</p>
        <Link to="/" className="btn btn--primary btn--main" style={{ marginTop: 12 }}>
          {copy.fun.notFoundButton}
        </Link>
      </section>
      <p className="solo__foot" style={{ marginTop: 0 }}>
        Если ссылку прислал друг, попроси скопировать её целиком.
      </p>
    </div>
  );
}
