import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CaptureList from './pages/CaptureList.jsx';
import CaptureNew from './pages/CaptureNew.jsx';
import CaptureReview from './pages/CaptureReview.jsx';
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
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
