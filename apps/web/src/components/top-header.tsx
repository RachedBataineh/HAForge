"use client";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { SidebarTrigger } from "@HAForge/ui/components/sidebar";
import { Separator } from "@HAForge/ui/components/separator";

export default function TopHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center border-b px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-4 !h-full" />
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
