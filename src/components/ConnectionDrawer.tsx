import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { ConnectionForm } from "@/components/ConnectionForm";
import type { ConnectionProfile, ConnectionProfileInput } from "@/types";

interface ConnectionDrawerProps {
  open: boolean;
  profile: ConnectionProfile | null;
  onOpenChange: (open: boolean) => void;
  onSave: (profile: ConnectionProfileInput) => Promise<void> | void;
}

export function ConnectionDrawer({
  open,
  profile,
  onOpenChange,
  onSave,
}: ConnectionDrawerProps) {
  const title = profile ? "Edit connection" : "New connection";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex justify-end">
          <Dialog.Popup className="flex h-full w-full max-w-2xl flex-col border-l bg-background shadow-2xl transition-transform duration-200 data-ending-style:translate-x-full data-starting-style:translate-x-full">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <Dialog.Title className="text-lg font-semibold tracking-tight">
                  {title}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  Connection secrets are saved in the operating system keychain.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={`Close ${title.toLowerCase()}`}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <ConnectionForm
                key={profile?.id ?? "new"}
                initialProfile={profile ?? undefined}
                onSave={onSave}
                onCancel={() => onOpenChange(false)}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
