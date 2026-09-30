import { getOrangeJellyCredit, type OrangeJellyCreditContent } from '@/lib/marketing/orange-jelly-credit';

interface OrangeJellyCreditStyleProps {
  className?: string;
  linkClassName?: string;
}

interface OrangeJellyCreditLineProps extends OrangeJellyCreditStyleProps {
  credit: OrangeJellyCreditContent;
}

/** The line itself. Separate from the fetch so it can be tested without a network. */
export function OrangeJellyCreditLine({
  credit,
  className,
  linkClassName,
}: OrangeJellyCreditLineProps): React.JSX.Element {
  return (
    <p className={className}>
      {credit.prefix ? `${credit.prefix} ` : null}
      <a href={credit.href} rel={credit.rel} className={linkClassName}>
        {credit.label}
      </a>
    </p>
  );
}

/** Async Server Component: reads the feed (cached for a day) and renders the line. */
export async function OrangeJellyCredit(props: OrangeJellyCreditStyleProps): Promise<React.JSX.Element> {
  const credit = await getOrangeJellyCredit();
  return <OrangeJellyCreditLine credit={credit} {...props} />;
}
