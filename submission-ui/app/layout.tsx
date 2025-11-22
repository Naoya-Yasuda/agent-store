import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Hub - エージェント登録",
  description: "安全なAIエージェントを登録・管理するプラットフォーム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="p-4 bg-gray-800 text-white flex gap-4">
          <a href="/" className="hover:underline">Home</a>
          <a href="/admin" className="hover:underline">Admin (Review)</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
