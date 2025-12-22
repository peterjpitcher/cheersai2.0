"use client"

import * as React from "react"
import {
    CalendarRange,
    Images,
    Link2,
    Settings,
    Sparkles,
    Command,
    User,
} from "lucide-react"

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
} from "@/components/ui/sidebar"
import { SignOutForm } from "@/components/auth/sign-out-form"
import Link from "next/link"
import { usePathname } from "next/navigation"

const items = [
    {
        title: "Planner",
        url: "/planner",
        icon: CalendarRange,
    },
    {
        title: "Create",
        url: "/create",
        icon: Sparkles,
    },
    {
        title: "Library",
        url: "/library",
        icon: Images,
    },
    {
        title: "Connections",
        url: "/connections",
        icon: Link2,
    },
    {
        title: "Settings",
        url: "/settings",
        icon: Settings,
    },
]

export function AppSidebar() {
    const pathname = usePathname()

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/planner">
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                    <Command className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">CheersAI</span>
                                    <span className="truncate text-xs">Command Centre</span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Application</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => {
                                const isActive = pathname === item.url || pathname.startsWith(`${item.url}/`);

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                                            <Link href={item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="My Profile">
                            <a href="#">
                                <User />
                                <span>Profile</span>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                {/* We can re-use the sign out form but might need to adjust it to fit the generic button structure if needed. 
            For now, let's just make a visual button that triggers it or wrap it. 
            Actually, let's keep it simple for now and leave SignOutForm as is if it renders a button,
            but we might need to style it to match SidebarMenuButton.
            A valid strategy is to wrap the functionality.
        */}
                <div className="p-2">
                    <SignOutForm />
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
