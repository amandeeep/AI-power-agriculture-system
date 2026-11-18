import { lazy, Suspense } from 'react';
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage, RegisterPage } from './pages/AuthPages';
// Pages are code-split: phones on slow rural networks only download what they open.
const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const CropPage = lazy(() => import('./pages/CropPage'));
const FertilizerPage = lazy(() => import('./pages/FertilizerPage'));
const DiseasePage = lazy(() => import('./pages/DiseasePage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const FieldsPage = lazy(() => import('./pages/FieldsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SystemStatus = lazy(() => import('./pages/SystemStatus'));

function RequireAuth() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <Spinner label={t('common.loading')} />;
  // Visitors who are not logged in see the public landing page first.
  return user ? <Outlet /> : <Navigate to="/welcome" replace />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold text-brand-800">{t('notFound.title')}</h1>
      <Link to="/" className="mt-4 inline-block font-semibold text-brand-700 underline">{t('notFound.home')}</Link>
    </div>
  );
}

function PageFallback() {
  const { t } = useTranslation();
  return <Spinner label={t('common.loading')} />;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route path="/welcome" element={<Landing />} />
      <Route path="/status" element={<SystemStatus />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="crop" element={<CropPage />} />
          <Route path="fertilizer" element={<FertilizerPage />} />
          <Route path="disease" element={<DiseasePage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="fields" element={<FieldsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  );
}
