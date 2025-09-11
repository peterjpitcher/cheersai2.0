import SubNav from '@/components/navigation/sub-nav';
import Container from '@/components/layout/container';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/dashboard" preset="dashboard" />
      <main>
        <Container className="section-y">{children}</Container>
      </main>
    </>
  );
}
