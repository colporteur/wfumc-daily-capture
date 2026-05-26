import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CaptureList from './pages/CaptureList.jsx';
import CaptureNew from './pages/CaptureNew.jsx';
import CaptureReview from './pages/CaptureReview.jsx';
import ShareTarget from './pages/ShareTarget.jsx';
import NotFound from './pages/NotFound.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/captures" element={<CaptureList />} />
        <Route path="/captures/new" element={<CaptureNew />} />
        <Route path="/captures/:id" element={<CaptureReview />} />
        {/* Web Share Target landing page. Hit by the SW's POST → 303
            redirect for file shares, OR directly via GET with text/title/url
            URL params for text-only shares. */}
        <Route path="/share" element={<ShareTarget />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
