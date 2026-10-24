import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Relay — Agent workflows, under control',
  description: 'Configure an agent once. Call it from your app. See and control every action.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
