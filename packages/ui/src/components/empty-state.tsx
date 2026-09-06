export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-2 text-sm text-balance">{children}</p>
      </div>
    </div>
  );
}
