import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import type { DiffRecord } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DiffTableProps {
  records: DiffRecord[];
  selectedIds: Set<number>;
  inFlightToggles: Set<number>;
  onToggle: (id: number) => void;
  onExpand: (record: DiffRecord) => void;
  recordsLoadError?: boolean;
  bulkActionInFlight?: boolean;
}

const kindStyles: Record<DiffRecord["kind"], string> = {
  added: "bg-green-100 text-green-700 border-green-300",
  modified: "bg-yellow-100 text-yellow-700 border-yellow-300",
  deleted: "bg-red-100 text-red-700 border-red-300",
};

const kindLabel: Record<DiffRecord["kind"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

function renderKeyCell(record: DiffRecord): React.ReactNode {
  let labels: Record<string, Record<string, unknown>> = {};
  try { labels = JSON.parse(record.refLabels || '{}'); } catch { /* empty */ }

  if (Object.keys(labels).length === 0) {
    return <span>{record.keyValue}</span>;
  }

  // Try to parse keyValue as a JSON object { fieldName: value, ... }
  let keyObj: Record<string, unknown>;
  try {
    keyObj = JSON.parse(record.keyValue);
    if (typeof keyObj !== 'object' || Array.isArray(keyObj)) throw new Error();
  } catch {
    // keyValue is a scalar — show it + all resolved display values
    const parts: string[] = [String(record.keyValue)];
    for (const resolved of Object.values(labels)) {
      if (resolved && typeof resolved === 'object') {
        parts.push(...Object.values(resolved as Record<string, unknown>).map(String));
      }
    }
    return <span title={record.keyValue}>{parts.join(' | ')}</span>;
  }

  // keyValue is a JSON object:
  // - non-ref fields: show their raw value
  // - ref fields (app_id): replace with display field VALUES from resolved labels
  const parts: string[] = [];
  for (const [field, val] of Object.entries(keyObj)) {
    if (labels[field] && typeof labels[field] === 'object') {
      // Replace ref ID with resolved display values only (no field names)
      parts.push(...Object.values(labels[field] as Record<string, unknown>).map(String));
    } else {
      parts.push(String(val));
    }
  }
  return <span title={record.keyValue}>{parts.join(' | ')}</span>;
}

export function DiffTable({
  records,
  selectedIds,
  inFlightToggles,
  onToggle,
  onExpand,
  recordsLoadError = false,
  bulkActionInFlight = false,
}: DiffTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 5,
  });

  if (recordsLoadError) {
    return (
      <div className="flex items-center justify-center h-32 text-red-600 dark:text-red-400 text-sm border border-red-300 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
        ⚠️ Failed to load records. Please try again or check the connection.
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm border rounded-lg">
        No records found
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col">
      {/* Header */}
      <div className="grid grid-cols-[32px_1fr_110px_44px] gap-2 px-3 py-2 bg-muted text-xs font-medium text-muted-foreground border-b items-center shrink-0">
        <span></span>
        <span>Key / ID</span>
        <span>Kind</span>
        <span></span>
      </div>

      {/* Virtualised rows */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: Math.min(records.length * 44, 440) }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const record = records[virtualRow.index];
            const isSelected = selectedIds.has(record.id);
            const isInFlight = inFlightToggles.has(record.id);

            return (
              <div
                key={record.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={cn(
                  "grid grid-cols-[32px_1fr_110px_44px] gap-2 px-3 items-center border-b last:border-0 text-sm",
                  isSelected && "bg-accent/40"
                )}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${record.keyValue}`}
                  checked={isSelected}
                  disabled={isInFlight || bulkActionInFlight}
                  onChange={() => onToggle(record.id)}
                  className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="truncate font-mono text-xs">
                  {renderKeyCell(record)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded border px-2 py-0.5 text-xs font-medium w-fit",
                    kindStyles[record.kind]
                  )}
                >
                  {kindLabel[record.kind]}
                </span>
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={record.kind === "modified" ? `View field diff for ${record.keyValue}` : `View document for ${record.keyValue}`}
                    onClick={() => onExpand(record)}
                    title={record.kind === "modified" ? "View field diff" : "View document"}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
