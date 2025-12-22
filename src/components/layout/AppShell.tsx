import { Sidebar } from "./Sidebar";
import { Topbar } from "./PageHeader";

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <div className="flex min-h-screen bg-background text-foreground font-sans">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <Topbar />
                <main className="flex-1 p-6 md:p-8 lg:p-10 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {children}
                </main>
            </div>
        </div>
    );
}
