"use client";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { SidebarTrigger } from "@HAForge/ui/components/sidebar";
import { Separator } from "@HAForge/ui/components/separator";

export default function TopHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="flex-1" />
      <ModeToggle />
      <UserMenu />
    </header>
  );
}
