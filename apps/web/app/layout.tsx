import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'NeuroStack - AI-Native Data Intelligence',
  description: 'The AI-native data + intelligence operating system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
