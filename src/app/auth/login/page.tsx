import { permanentRedirect } from "next/navigation";

export default function LegacyAuthLoginRedirectPage() {
  permanentRedirect("/login");
}
