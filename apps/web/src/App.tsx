import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from './components/Toast.js';
import { useMe } from './lib/queries/index.js';
import { CreateGroupPage } from './pages/CreateGroupPage.js';
import { ExpensePage } from './pages/ExpensePage.js';
import { GroupPage } from './pages/GroupPage.js';
import { GroupsPage } from './pages/GroupsPage.js';
import { InvitePage } from './pages/InvitePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

/** Пускает только вошедших и представившихся; остальных отправляет на вход и возвращает обратно. */
function RequireUser({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return null;
  if (me.isError) return <p className="hint" style={{ padding: 20 }}>Нет связи с сервером. Обнови страницу чуть позже.</p>;
  if (!me.data?.name) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/j/:token" element={<InvitePage />} />
          <Route path="/" element={<RequireUser><GroupsPage /></RequireUser>} />
          <Route path="/groups/new" element={<RequireUser><CreateGroupPage /></RequireUser>} />
          <Route path="/groups/:id" element={<RequireUser><GroupPage tab="balance" /></RequireUser>} />
          <Route path="/groups/:id/expenses" element={<RequireUser><GroupPage tab="expenses" /></RequireUser>} />
          <Route path="/groups/:id/expenses/new" element={<RequireUser><ExpensePage /></RequireUser>} />
          <Route path="/groups/:id/expenses/:expenseId" element={<RequireUser><ExpensePage /></RequireUser>} />
          <Route path="/groups/:id/feed" element={<RequireUser><GroupPage tab="feed" /></RequireUser>} />
          <Route path="/groups/:id/settings" element={<RequireUser><SettingsPage /></RequireUser>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
