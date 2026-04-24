"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@HAForge/ui/components/sidebar";
import { Database, Home, Server, HardDrive, Settings, KeyRound, Network, Globe, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { title: "Dashboard", href: "/dashboard" as const, icon: Home },
  { title: "Clusters", href: "/dashboard/clusters" as const, icon: Server },
  { title: "Servers", href: "/dashboard/servers" as const, icon: HardDrive },
  { title: "Load Balancers", href: "/dashboard/load-balancers" as const, icon: Network },
  { title: "Networks", href: "/dashboard/networks" as const, icon: Globe },
  { title: "Floating IPs", href: "/dashboard/floating-ips" as const, icon: ArrowUpDown },
  { title: "SSH Keys", href: "/dashboard/ssh-keys" as const, icon: KeyRound },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              isActive={false}
              render={<Link href="/" />}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Database className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold" style={{ fontSize: '16px' }}>HAForge</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel style={{ fontSize: '12px' }}>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title} style={{ paddingBlock: '2px' }}>
              <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={item.href === "/dashboard" ? pathname === "/dashboard" : pathname === item.href || pathname.startsWith(item.href + "/")}
                    tooltip={item.title}
                    style={{ height: '40px' }}
                  >
                    <item.icon />
                    <span style={{ fontSize: '16px', lineHeight: '20px' }}>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/dashboard/settings" />}
              isActive={pathname === "/dashboard/settings" || pathname.startsWith("/dashboard/settings/")}
              tooltip="Settings"
              style={{ height: '40px' }}
            >
              <Settings />
              <span style={{ fontSize: '16px', lineHeight: '20px' }}>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
