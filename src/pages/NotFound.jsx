import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center space-y-3">
        <h1 className="font-serif text-2xl text-umc-900">Not found</h1>
        <p className="text-sm text-gray-600">
          That page doesn't exist (or you don't have access to it).
        </p>
        <Link to="/" className="btn-primary inline-block">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
