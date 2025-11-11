import './globals.css';

export const metadata = {
  title: 'Human Review Dashboard',
  description: 'Review progress viewer'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
