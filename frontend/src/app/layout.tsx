import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import Script from 'next/script';
import { UpdateSplashScreen } from '@/components/UpdateSplashScreen';

export const metadata: Metadata = {
  title: 'Match Tracker | Grassroots Football',
  description: 'Mobile offline match tracker, player minutes, goalkeeper rotation, and squad statistics for football.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Match Tracker'
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg'
  }
};

export const viewport: Viewport = {
  themeColor: '#0a0e14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>
        <div className="app-container">
          {children}
          <UpdateSplashScreen />
        </div>

        <Script id="sw-registration" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                const hadPreviousController = !!navigator.serviceWorker.controller;
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  if (hadPreviousController && !refreshing) {
                    refreshing = true;
                    window.location.reload();
                  }
                });

                navigator.serviceWorker.register('/sw.js').then((reg) => {
                  reg.update().catch(() => {});
                  document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                      reg.update().catch(() => {});
                    }
                  });
                }).catch(() => {});
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
