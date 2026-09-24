import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Link in Bio | Cheers",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
