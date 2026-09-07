import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { PrefsProvider } from './lib/prefs';
import { ThemeProvider } from './lib/theme';
import { BrandingProvider } from './lib/branding';
import { AccountPrefsSync } from './lib/prefsSync';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Terminal } from './pages/Terminal';
import { Account } from './pages/Account';
import { Settings } from './pages/Settings';
import { Services } from './pages/Services';
import { Files } from './pages/Files';
import { Antivirus } from './pages/Antivirus';
import { SysUpdates } from './pages/SysUpdates';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/taskmanager" element={<Protected><Services /></Protected>} />
      <Route path="/terminal" element={<Protected><Terminal /></Protected>} />
      <Route path="/files" element={<Protected><Files /></Protected>} />
      <Route path="/antivirus" element={<Protected><Antivirus /></Protected>} />
      <Route path="/updates" element={<Protected><SysUpdates /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <I18nProvider>
      {/* Anwendungsname global – wird auch auf der Anmeldeseite gebraucht */}
      {/* basename aus dem Build-Basispfad: nur so stimmen die Routen auch,
          wenn die Oberfläche unter einem Unterpfad ausgeliefert wird. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <PrefsProvider>
            <ThemeProvider>
              <BrandingProvider>
                {/* Sprache und Abmeldezeit des Kontos anwenden */}
                <AccountPrefsSync />
                <AppRoutes />
              </BrandingProvider>
            </ThemeProvider>
          </PrefsProvider>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  );
}
