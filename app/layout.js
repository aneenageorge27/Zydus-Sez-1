import '../css/styles.css';

export const metadata = {
  title: 'Zydus SEZ-1 — Single Line Diagram',
};

/* Matches the meta tag the page carried before: the canvas does its own
   zooming, so the browser's must stay out of the way. */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {children}
      </body>
    </html>
  );
}
