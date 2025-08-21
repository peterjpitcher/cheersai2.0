import SubNav from '@/components/navigation/sub-nav';

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/media" preset="media" />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}