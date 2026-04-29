import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import { AppSidebar } from "@/components/app-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
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
          <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
            <AppSidebar />
            <SidebarInset>
              <TopHeader />
              <div className="flex-1 overflow-auto">
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
