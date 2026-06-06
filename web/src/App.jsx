import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './auth';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Spinner from './components/Spinner';

import LoginPage         from './pages/LoginPage';
import BatchesPage       from './pages/BatchesPage';
import SemestersPage     from './pages/SemestersPage';
import CoursesPage       from './pages/CoursesPage';
import ProjectsPage      from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ChatbotPage       from './pages/ChatbotPage';
import AdminPage         from './pages/AdminPage';
import MarksPage         from './pages/MarksPage';
import DocsPage          from './pages/DocsPage';

function PrivateRoute({ children, adminOnly = false }) {
  const { role, loading } = useAuth();

  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <Spinner large />
      </div>
    );
  }
  if (adminOnly && !['admin', 'hod'].includes(role)) return <Navigate to="/batches" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/*" element={
        <PrivateRoute>
          <Layout>
            <Routes>
              <Route index element={<Navigate to="/batches" replace />} />
              <Route path="batches"                          element={<BatchesPage />} />
              <Route path="batches/:batchId/semesters"       element={<SemestersPage />} />
              <Route path="semesters/:semId/courses"         element={<CoursesPage />} />
              <Route path="courses/:courseId/projects"       element={<ProjectsPage />} />
              <Route path="courses/:courseId/marks"          element={<MarksPage />} />
              <Route path="courses/:courseId/docs"           element={<DocsPage />} />
              <Route path="projects/:projectId"              element={<ProjectDetailPage />} />
              <Route path="chat"                             element={<ChatbotPage />} />
              <Route path="admin"                            element={
                <PrivateRoute adminOnly>
                  <AdminPage />
                </PrivateRoute>
              } />
            </Routes>
          </Layout>
        </PrivateRoute>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
