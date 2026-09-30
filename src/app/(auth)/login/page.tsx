import { Suspense } from 'react';

import { AuthAside } from '@/components/auth/auth-card';
import { HERO } from '@/content/homepage';

import { LoginForm } from './login-form';
import { NoAccountLine, NoAccountPlaceholder } from './no-account-line';

/**
 * `/login`. The form is a client component (login-form.tsx). The panel beside
 * it and the "Don't have an account?" line are built here on the server, so
 * the homepage's words stay out of the browser bundle and the sign-up switch
 * is read on the server. The line has its own Suspense boundary: the form
 * never waits on the switch read.
 */
export default function LoginPage(): React.JSX.Element {
  return (
    <LoginForm
      aside={
        <AuthAside
          eyebrow={HERO.eyebrow}
          title="Your venue's social media,"
          accent="sorted."
          intro="Create once, publish everywhere. Cheers adapts your content for Facebook and Instagram, so you can focus on running your venue."
          points={HERO.points}
        />
      }
      noAccount={
        <Suspense fallback={<NoAccountPlaceholder />}>
          <NoAccountLine />
        </Suspense>
      }
    />
  );
}
