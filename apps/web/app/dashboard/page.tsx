import { redirect } from 'next/navigation';
import { currentAccount } from '../../lib/server';
import { LocaleProvider } from '../../lib/locale-context';
import { Dashboard } from '../../components/dashboard';
export const metadata = { title: 'Your workspace', robots: { index: false, follow: false } };
export default async function DashboardPage() {
  const account = await currentAccount();
  if (!account) redirect('/login');
  return (
    <LocaleProvider locale={account.locale} timezone={account.timezone}>
      <Dashboard account={account} />
    </LocaleProvider>
  );
}
