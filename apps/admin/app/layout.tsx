import type { Metadata } from 'next';
import '../../web/app/globals.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Orbit moderation',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
