import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthFlow } from '../components/AuthFlow.js';
import { useMe } from '../lib/session.js';

export function LoginPage() {
  const meQuery = useMe();
  const me = meQuery.data;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') ?? '/';
  if (me?.name) return <Navigate to={next} replace />;
  // Пока не знаем, вошёл ли человек, форму не показываем: иначе вошедший без имени попадёт на шаг почты.
  if (meQuery.isPending) return null;

  return (
    <div className="solo">
      <p className="solo__brand">Совместные расходы</p>
      <section className="solo__body">
        <h1 className="title">Кто за кого платил и кто кому должен</h1>
        <p className="lead">Записывайте общие расходы в поездке или в квартире. Приложение посчитает, кто кому сколько должен, и как рассчитаться меньшим числом переводов.</p>
      </section>
      <div style={{ marginTop: 28 }}>
        <AuthFlow onDone={() => void navigate(next, { replace: true })} />
      </div>
      <p className="solo__foot">Деньги приложение не переводит: только считает и запоминает.</p>
    </div>
  );
}
