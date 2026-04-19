import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import { AppSidebar } from "@/components/app-sidebar";
import Providers from "@/components/providers";
import TopHeader from "@/components/top-header";
import { SidebarInset, SidebarProvider } from "@HAForge/ui/components/sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HAForge",
  description: "PostgreSQL HA Cluster Automation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <TopHeader />
              <div className="flex-1 overflow-auto">
                {children}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
