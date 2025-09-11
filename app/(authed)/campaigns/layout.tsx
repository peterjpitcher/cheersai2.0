import Container from '@/components/layout/container';

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <main>
        <Container className="py-4">{children}</Container>
      </main>
    </>
  );
}
