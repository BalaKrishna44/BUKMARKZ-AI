export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f1f9f4] p-6" aria-busy="true" aria-label="Loading your bookmarks">
      <div className="mx-auto max-w-7xl space-y-3">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gradient-to-r from-[#eaf3ed] via-white to-[#eaf3ed] motion-reduce:animate-none" />)}
      </div>
    </div>
  );
}
