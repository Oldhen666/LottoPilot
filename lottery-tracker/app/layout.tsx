import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lottery Results Tracker',
  description: 'Track lottery draw results',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <nav className="border-b border-slate-800 bg-slate-900/50 px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <a href="/" className="text-lg font-semibold text-amber-400">
              Lottery Results Tracker
            </a>
            <div className="flex gap-4">
              <a href="/" className="text-slate-300 hover:text-white">Dashboard</a>
              <a href="/errors" className="text-slate-300 hover:text-white">Errors</a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
