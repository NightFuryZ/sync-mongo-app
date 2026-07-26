import { Check, LockKeyhole } from "lucide-react";
import { Link } from "react-router-dom";
import type { WorkflowStep } from "@/lib/workflow";
import { cn } from "@/lib/utils";

interface WorkflowStepperProps {
  steps: WorkflowStep[];
}

function StepMarker({
  index,
  state,
}: {
  index: number;
  state: WorkflowStep["state"];
}) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
        state === "current" &&
          "border-primary bg-primary text-primary-foreground shadow-sm",
        state === "complete" &&
          "border-emerald-600 bg-emerald-50 text-emerald-700",
        state === "available" &&
          "border-border bg-background text-muted-foreground",
        state === "locked" &&
          "border-border bg-muted text-muted-foreground"
      )}
      aria-hidden="true"
    >
      {state === "complete" ? (
        <Check className="size-3.5" strokeWidth={2.5} />
      ) : state === "locked" ? (
        <LockKeyhole className="size-3" />
      ) : (
        index + 1
      )}
    </span>
  );
}

function StepContent({
  step,
  index,
}: {
  step: WorkflowStep;
  index: number;
}) {
  return (
    <>
      <StepMarker index={index} state={step.state} />
      <span className="min-w-0 text-left">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            step.state === "current" && "text-primary",
            step.state === "locked" && "text-muted-foreground"
          )}
        >
          {step.label}
        </span>
        <span className="hidden truncate text-xs text-muted-foreground xl:block">
          {step.state === "locked" ? step.blockedReason : step.description}
        </span>
      </span>
    </>
  );
}

export function WorkflowStepper({ steps }: WorkflowStepperProps) {
  return (
    <nav
      aria-label="Sync workflow"
      className="border-b bg-background px-6 py-3"
    >
      <ol className="mx-auto grid max-w-6xl grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={cn(
              "relative pr-3",
              index > 0 &&
                "before:absolute before:top-3.5 before:-left-[calc(50%-0.875rem)] before:h-px before:w-[calc(50%-0.875rem)] before:bg-border"
            )}
          >
            {step.state === "locked" ? (
              <div
                aria-disabled="true"
                title={step.blockedReason}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
              >
                <StepContent step={step} index={index} />
              </div>
            ) : (
              <Link
                to={step.path}
                aria-current={step.state === "current" ? "step" : undefined}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StepContent step={step} index={index} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
