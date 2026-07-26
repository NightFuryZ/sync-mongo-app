import { Cable, DatabaseZap, RefreshCw } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSyncConfigStore } from "@/store/syncConfig";
import { useDiffResultsStore } from "@/store/diffResults";
import {
  buildWorkflowSteps,
  getWorkflowContext,
  type WorkflowSnapshot,
} from "@/lib/workflow";
import { WorkflowContextBar } from "@/components/WorkflowContextBar";
import { WorkflowStepper } from "@/components/WorkflowStepper";

const nav = [
  { path: "/", label: "Connections", icon: Cable },
  { path: "/sync-config", label: "New Sync", icon: RefreshCw },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const sourceProfile = useSyncConfigStore((state) => state.sourceProfile);
  const targetProfile = useSyncConfigStore((state) => state.targetProfile);
  const sourceDatabase = useSyncConfigStore((state) => state.sourceDatabase);
  const targetDatabase = useSyncConfigStore((state) => state.targetDatabase);
  const collections = useSyncConfigStore((state) => state.collections);
  const summaries = useDiffResultsStore((state) => state.summaries);
  const isWorkflowRoute = pathname !== "/";

  const workflowSnapshot: WorkflowSnapshot = {
    sourceProfile,
    targetProfile,
    sourceDatabase,
    targetDatabase,
    selectedCollections: collections
      .filter(({ selected }) => selected)
      .map(({ name }) => name),
    completedDiffCollections: Object.keys(summaries),
  };
  const steps = buildWorkflowSteps(pathname, workflowSnapshot);
  const context = getWorkflowContext(workflowSnapshot);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <DatabaseZap className="size-5" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Mongo Sync</h1>
            <p className="text-xs text-muted-foreground">Desktop workspace</p>
          </div>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 p-3">
          <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
          <div className="space-y-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === "/"
                  ? pathname === "/"
                  : pathname !== "/";

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    isActive &&
                      "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t px-5 py-4 text-xs leading-relaxed text-muted-foreground">
          Credentials stay in your system keychain.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isWorkflowRoute && (
          <>
            <WorkflowContextBar context={context} />
            <WorkflowStepper steps={steps} />
          </>
        )}
        <main className="min-h-0 flex-1 overflow-auto bg-muted/15">
          <div className="min-h-full p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
