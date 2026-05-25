export default function LoadingSpinner({ label }) {
  return (
    <div className="flex items-center gap-3 text-sm text-gray-500 py-8 justify-center">
      <span
        className="inline-block w-4 h-4 border-2 border-gray-300 border-t-umc-700 rounded-full animate-spin"
        aria-hidden="true"
      />
      {label || 'Loading…'}
    </div>
  );
}
