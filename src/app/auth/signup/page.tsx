import { permanentRedirect } from "next/navigation";

export default function LegacySignupRedirectPage() {
  permanentRedirect("/login");
}
