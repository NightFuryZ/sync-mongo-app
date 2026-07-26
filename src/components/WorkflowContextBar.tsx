import { ArrowRight, Database, Layers3 } from "lucide-react";
import type { WorkflowContext } from "@/lib/workflow";

function ConnectionContext({
  name,
  database,
  fallback,
}: {
  name: string;
  database: string;
  fallback: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{name || fallback}</p>
      <p className="truncate text-xs text-muted-foreground">
        {database || "No database selected"}
      </p>
    </div>
  );
}

export function WorkflowContextBar({
  context,
}: {
  context: WorkflowContext;
}) {
  return (
    <div className="border-b bg-muted/35 px-6 py-2.5">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <ConnectionContext
          name={context.sourceName}
          database={context.sourceDatabase}
          fallback="Select source"
        />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <ConnectionContext
          name={context.targetName}
          database={context.targetDatabase}
          fallback="Select target"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
          <Layers3 className="size-3.5" />
          <span>
            {context.collectionCount}{" "}
            {context.collectionCount === 1 ? "collection" : "collections"}
          </span>
        </div>
      </div>
    </div>
  );
}
