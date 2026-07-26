export type WorkflowStepId = "configure" | "review" | "script" | "execute";
export type WorkflowStepState = "available" | "current" | "complete" | "locked";

export interface WorkflowProfileSummary {
  id: string;
  name: string;
}

export interface WorkflowSnapshot {
  sourceProfile: WorkflowProfileSummary | null;
  targetProfile: WorkflowProfileSummary | null;
  sourceDatabase: string;
  targetDatabase: string;
  selectedCollections: string[];
  completedDiffCollections: string[];
}

export interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  shortLabel: string;
  description: string;
  path: string;
  state: WorkflowStepState;
  blockedReason?: string;
}

export interface WorkflowContext {
  sourceName: string;
  targetName: string;
  sourceDatabase: string;
  targetDatabase: string;
  collectionCount: number;
}

const workflowDefinitions: Omit<WorkflowStep, "state" | "blockedReason">[] = [
  {
    id: "configure",
    label: "Configure",
    shortLabel: "Configure",
    description: "Choose source and target",
    path: "/sync-config",
  },
  {
    id: "review",
    label: "Review Diff",
    shortLabel: "Review",
    description: "Review database changes",
    path: "/diff",
  },
  {
    id: "script",
    label: "Preview Script",
    shortLabel: "Script",
    description: "Inspect the generated script",
    path: "/script",
  },
  {
    id: "execute",
    label: "Execute",
    shortLabel: "Execute",
    description: "Apply selected changes",
    path: "/execution-log",
  },
];

function getCurrentStepId(pathname: string): WorkflowStepId {
  return (
    workflowDefinitions.find(({ path }) => pathname.startsWith(path))?.id ??
    "configure"
  );
}

function isConfigurationReady(snapshot: WorkflowSnapshot) {
  return Boolean(
    snapshot.sourceProfile &&
      snapshot.targetProfile &&
      snapshot.sourceDatabase &&
      snapshot.targetDatabase &&
      snapshot.selectedCollections.length > 0
  );
}

function isDiffReviewComplete(snapshot: WorkflowSnapshot) {
  if (!isConfigurationReady(snapshot)) {
    return false;
  }

  const completed = new Set(snapshot.completedDiffCollections);
  return snapshot.selectedCollections.every((collection) =>
    completed.has(collection)
  );
}

export function buildWorkflowSteps(
  pathname: string,
  snapshot: WorkflowSnapshot
): WorkflowStep[] {
  const currentStepId = getCurrentStepId(pathname);
  const currentIndex = workflowDefinitions.findIndex(
    ({ id }) => id === currentStepId
  );
  const configurationReady = isConfigurationReady(snapshot);
  const diffReviewComplete = isDiffReviewComplete(snapshot);

  return workflowDefinitions.map((definition, index) => {
    if (definition.id === currentStepId) {
      return { ...definition, state: "current" };
    }

    if (definition.id === "configure") {
      return {
        ...definition,
        state: configurationReady ? "complete" : "available",
      };
    }

    if (definition.id === "review") {
      return configurationReady
        ? {
            ...definition,
            state: diffReviewComplete ? "complete" : "available",
          }
        : {
            ...definition,
            state: "locked",
            blockedReason:
              "Choose source and target connections, databases, and collections first.",
          };
    }

    if (!diffReviewComplete) {
      return {
        ...definition,
        state: "locked",
        blockedReason: "Review all selected collections first.",
      };
    }

    return {
      ...definition,
      state: index < currentIndex ? "complete" : "available",
    };
  });
}

export function getWorkflowContext(
  snapshot: WorkflowSnapshot
): WorkflowContext {
  return {
    sourceName: snapshot.sourceProfile?.name ?? "",
    targetName: snapshot.targetProfile?.name ?? "",
    sourceDatabase: snapshot.sourceDatabase,
    targetDatabase: snapshot.targetDatabase,
    collectionCount: snapshot.selectedCollections.length,
  };
}
