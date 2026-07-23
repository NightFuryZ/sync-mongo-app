import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const nav = [
  { path: "/", label: "🔗 Connections" },
  { path: "/sync-config", label: "⚙️ Sync Config" },
  { path: "/diff", label: "📊 Diff View" },
  { path: "/script", label: "📜 Script" },
  { path: "/execution-log", label: "🚀 Execution" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-48 border-r flex flex-col p-3 gap-1">
        <h1 className="text-sm font-bold px-2 py-2 mb-2">MongoDB Sync</h1>
        {nav.map((n) => (
          <Link
            key={n.path}
            to={n.path}
            className={cn(
              "text-sm px-2 py-1.5 rounded hover:bg-accent",
              pathname === n.path && "bg-accent font-medium"
            )}
          >
            {n.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
