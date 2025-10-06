import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "CheersAI Link in Bio",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
