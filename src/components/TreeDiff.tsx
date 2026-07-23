import { formatBsonValueRecursive, isBsonWrapper } from "@/lib/bsonDisplay";

interface TreeDiffProps {
  sourceDoc: Record<string, unknown>;
  targetDoc: Record<string, unknown>;
}

function renderValue(val: unknown): string {
  return formatBsonValueRecursive(val);
}

function TreeDiffNode({
  sourceDoc,
  targetDoc,
  depth,
}: {
  sourceDoc: Record<string, unknown>;
  targetDoc: Record<string, unknown>;
  depth: number;
}) {
  const MAX_DEPTH = 3;
  const allKeys = Array.from(
    new Set([...Object.keys(sourceDoc), ...Object.keys(targetDoc)])
  );

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      {allKeys.map((key) => {
        const inSrc = key in sourceDoc;
        const inTgt = key in targetDoc;
        const srcVal = sourceDoc[key];
        const tgtVal = targetDoc[key];

        if (inSrc && !inTgt) {
          return (
            <div key={key} className="text-red-500 line-through py-0.5">
              🔴 {key}: {renderValue(srcVal)}
            </div>
          );
        }

        if (!inSrc && inTgt) {
          return (
            <div key={key} className="text-green-500 py-0.5">
              🟢 {key}: {renderValue(tgtVal)}
            </div>
          );
        }

        const same = JSON.stringify(srcVal) === JSON.stringify(tgtVal);
        if (same) {
          return (
            <div key={key} className="text-muted-foreground py-0.5">
              {key}: {renderValue(srcVal)}
            </div>
          );
        }

        // Recurse into nested objects up to MAX_DEPTH
        // But treat BSON wrappers as leaf values
        if (
          depth < MAX_DEPTH &&
          typeof srcVal === "object" &&
          srcVal !== null &&
          !Array.isArray(srcVal) &&
          !isBsonWrapper(srcVal) &&
          typeof tgtVal === "object" &&
          tgtVal !== null &&
          !Array.isArray(tgtVal) &&
          !isBsonWrapper(tgtVal)
        ) {
          return (
            <div key={key} className="py-0.5">
              <span className="text-yellow-500 font-semibold">🟡 {key}:</span>
              <TreeDiffNode
                sourceDoc={srcVal as Record<string, unknown>}
                targetDoc={tgtVal as Record<string, unknown>}
                depth={depth + 1}
              />
            </div>
          );
        }

        return (
          <div key={key} className="py-0.5">
            <span className="text-muted-foreground">{key}: </span>
            <span className="text-red-500 line-through mr-1">{renderValue(srcVal)}</span>
            <span className="text-muted-foreground mr-1">→</span>
            <span className="text-green-500">{renderValue(tgtVal)}</span>
            <span className="ml-1">🟡</span>
          </div>
        );
      })}
    </div>
  );
}

export function TreeDiff({ sourceDoc, targetDoc }: TreeDiffProps) {
  return (
    <div className="font-mono text-xs bg-muted rounded p-3 overflow-auto max-h-96 border">
      <TreeDiffNode sourceDoc={sourceDoc} targetDoc={targetDoc} depth={0} />
    </div>
  );
}
