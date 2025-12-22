import { Skeleton } from "@/components/ui/skeleton";

export function PlannerSkeleton() {
    return (
        <section className="space-y-6">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                    <Skeleton className="h-8 w-48 bg-brand-mist/20" />
                    <Skeleton className="h-4 w-32 bg-brand-mist/20" />
                </div>
                <div className="flex flex-col gap-3 sm:items-end">
                    <div className="flex flex-wrap gap-2">
                        <Skeleton className="h-9 w-32 rounded-full bg-brand-mist/20" />
                        <Skeleton className="h-9 w-20 rounded-full bg-brand-mist/20" />
                        <Skeleton className="h-9 w-28 rounded-full bg-brand-mist/20" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-9 w-32 rounded-lg bg-brand-mist/20" />
                        <Skeleton className="h-9 w-40 rounded-lg bg-brand-mist/20" />
                    </div>
                </div>
            </header>

            <div className="overflow-x-auto">
                <div className="w-full space-y-3">
                    <div className="hidden grid-cols-7 gap-3 md:grid">
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className="px-2 text-center">
                                <Skeleton className="mx-auto h-4 w-12 bg-brand-mist/20" />
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
                        {Array.from({ length: 35 }).map((_, i) => ( // Show 5 weeks
                            <div
                                key={i}
                                className="min-h-[220px] rounded-2xl border border-brand-mist/30 bg-white/40 p-4"
                            >
                                <header className="flex items-start justify-between gap-2 mb-4">
                                    <div className="space-y-1">
                                        <Skeleton className="h-4 w-6 bg-brand-mist/20" />
                                        <Skeleton className="h-3 w-8 bg-brand-mist/20" />
                                    </div>
                                </header>
                                <div className="space-y-2">
                                    <Skeleton className="h-16 w-full rounded-xl bg-brand-mist/10" />
                                    <Skeleton className="h-16 w-full rounded-xl bg-brand-mist/10" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
