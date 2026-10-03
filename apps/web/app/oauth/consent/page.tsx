import { redirect } from 'next/navigation';
import { currentAccount } from '../../../lib/server';
import { Brand } from '../../../components/brand';
import { OAuthConsent } from '../../../components/oauth-consent';
export const metadata = { title: 'Authorize application', robots: { index: false, follow: false } };
export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  if (!(await currentAccount())) redirect('/login');
  if (!request || !/^oar_[a-f0-9]{32}$/.test(request))
    return (
      <main id="main" className="auth-page">
        <h1>Invalid authorization request</h1>
      </main>
    );
  return (
    <main id="main" className="auth-page">
      <Brand />
      <OAuthConsent requestId={request} />
    </main>
  );
}
