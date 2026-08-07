import { formatBsonValueRecursive, isBsonWrapper } from "@/lib/bsonDisplay";

interface TreeDiffProps {
  currentDoc: Record<string, unknown>;
  desiredDoc: Record<string, unknown>;
}

function renderValue(val: unknown): string {
  return formatBsonValueRecursive(val);
}

function TreeDiffNode({
  currentDoc,
  desiredDoc,
  depth,
}: {
  currentDoc: Record<string, unknown>;
  desiredDoc: Record<string, unknown>;
  depth: number;
}) {
  const MAX_DEPTH = 3;
  const allKeys = Array.from(
    new Set([...Object.keys(currentDoc), ...Object.keys(desiredDoc)])
  );

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      {allKeys.map((key) => {
        const inCurrent = key in currentDoc;
        const inDesired = key in desiredDoc;
        const currentValue = currentDoc[key];
        const desiredValue = desiredDoc[key];

        if (inCurrent && !inDesired) {
          return (
            <div key={key} className="text-red-500 line-through py-0.5">
              🔴 {key}: {renderValue(currentValue)}
            </div>
          );
        }

        if (!inCurrent && inDesired) {
          return (
            <div key={key} className="text-green-500 py-0.5">
              🟢 {key}: {renderValue(desiredValue)}
            </div>
          );
        }

        const same =
          JSON.stringify(currentValue) === JSON.stringify(desiredValue);
        if (same) {
          return (
            <div key={key} className="text-muted-foreground py-0.5">
              {key}: {renderValue(currentValue)}
            </div>
          );
        }

        // Recurse into nested objects up to MAX_DEPTH
        // But treat BSON wrappers as leaf values
        if (
          depth < MAX_DEPTH &&
          typeof currentValue === "object" &&
          currentValue !== null &&
          !Array.isArray(currentValue) &&
          !isBsonWrapper(currentValue) &&
          typeof desiredValue === "object" &&
          desiredValue !== null &&
          !Array.isArray(desiredValue) &&
          !isBsonWrapper(desiredValue)
        ) {
          return (
            <div key={key} className="py-0.5">
              <span className="text-yellow-500 font-semibold">🟡 {key}:</span>
              <TreeDiffNode
                currentDoc={currentValue as Record<string, unknown>}
                desiredDoc={desiredValue as Record<string, unknown>}
                depth={depth + 1}
              />
            </div>
          );
        }

        return (
          <div key={key} className="py-0.5">
            <span className="text-muted-foreground">{key}: </span>
            <span className="text-red-500 line-through mr-1">{renderValue(currentValue)}</span>
            <span className="text-muted-foreground mr-1">→</span>
            <span className="text-green-500">{renderValue(desiredValue)}</span>
            <span className="ml-1">🟡</span>
          </div>
        );
      })}
    </div>
  );
}

export function TreeDiff({ currentDoc, desiredDoc }: TreeDiffProps) {
  return (
    <div className="font-mono text-xs bg-muted rounded p-3 overflow-auto max-h-96 border">
      <TreeDiffNode currentDoc={currentDoc} desiredDoc={desiredDoc} depth={0} />
    </div>
  );
}
