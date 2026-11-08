import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthFlow } from '../components/AuthFlow.js';
import { useMe } from '../lib/session.js';

export function LoginPage() {
  const me = useMe().data;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') ?? '/';
  if (me?.name) return <Navigate to={next} replace />;

  return (
    <div className="solo">
      <p className="solo__brand">Совместные расходы</p>
      <section className="solo__body">
        <h1 className="title">Кто за кого платил и кто кому должен</h1>
        <p className="lead">Записывайте общие расходы в поездке или в квартире. Приложение посчитает, кто кому сколько должен, и как рассчитаться меньшим числом переводов.</p>
      </section>
      <div style={{ marginTop: 28 }}>
        <AuthFlow onDone={() => navigate(next, { replace: true })} />
      </div>
      <p className="solo__foot">Деньги приложение не переводит: только считает и запоминает.</p>
    </div>
  );
}
