import SubNav from "@/components/navigation/sub-nav";

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SubNav base="/media" preset="media" />
      <main className="container mx-auto px-4 max-w-screen-2xl py-8">
        {children}
      </main>
    </div>
  );
}

