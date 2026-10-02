import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zero2Offer | Premium Career Portal",
  description: "Accelerate your career with Zero2Offer",
  icons: { icon: [], apple: [] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
