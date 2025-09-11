import SubNav from "@/components/navigation/sub-nav";
import Container from "@/components/layout/container";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SubNav base="/admin" preset="admin" />
      <main>
        <Container className="section-y">{children}</Container>
      </main>
    </div>
  );
}
