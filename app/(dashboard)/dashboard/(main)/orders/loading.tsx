export default function OrdersLoading() {
  return (
    <section className="space-y-5" aria-label="Loading orders">
      <div className="h-16 w-full animate-pulse rounded-xl bg-white" />
      <div className="h-14 w-full animate-pulse rounded-xl bg-white" />
      <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-white" />)}
      </div>
    </section>
  );
}