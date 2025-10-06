import { SignOutButton } from "@/components/auth/sign-out-button";
import { signOut } from "@/lib/auth/actions";

export function SignOutForm() {
  return (
    <form action={signOut} className="inline-flex">
      <SignOutButton />
    </form>
  );
}
