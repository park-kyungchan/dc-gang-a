import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SPT 수업 기록",
  applicationName: "SPT",
  description: "학생별 대화·관찰과 수업 후 검토",
  robots: {index:false,follow:false},
  icons: {
    icon: "/favicon.svg",
    apple: [{url:"/apple-touch-icon.png",sizes:"180x180",type:"image/png"}],
  },
  appleWebApp: {capable:true,title:"SPT",statusBarStyle:"default"},
  // Vinext 0.0.50 omits viewportFit and the legacy Apple capable tag.
  // Emit one complete viewport through metadata, with no duplicate default below.
  other: {
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
    "apple-mobile-web-app-capable": "yes",
  },
};
export const viewport: Viewport = {width:undefined,initialScale:undefined,themeColor:'#f8f6ed',colorScheme:'light'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>){return <html lang="ko"><head><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body>{children}</body></html>;}
