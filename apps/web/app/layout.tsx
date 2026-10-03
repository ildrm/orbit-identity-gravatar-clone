import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: {
    default: 'Orbit Identity — Your identity, on your terms',
    template: '%s · Orbit Identity',
  },
  description: 'Create a lasting identity, choose your personas, and control what you share.',
  metadataBase: new URL(process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080'),
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Orbit Identity',
    description: 'One identity. Your many sides.',
    type: 'website',
  },
};
export const dynamic = 'force-dynamic';
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
