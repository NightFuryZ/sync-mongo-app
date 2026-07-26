import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";

const ConnectionsScreen = lazy(() =>
  import("./screens/ConnectionsScreen").then(({ ConnectionsScreen: Screen }) => ({
    default: Screen,
  }))
);
const SyncConfigScreen = lazy(() =>
  import("./screens/SyncConfigScreen").then(({ SyncConfigScreen: Screen }) => ({
    default: Screen,
  }))
);
const DiffViewScreen = lazy(() =>
  import("./screens/DiffViewScreen").then(({ DiffViewScreen: Screen }) => ({
    default: Screen,
  }))
);
const ScriptPreviewScreen = lazy(() =>
  import("./screens/ScriptPreviewScreen").then(({ ScriptPreviewScreen: Screen }) => ({
    default: Screen,
  }))
);
const ExecutionLogScreen = lazy(() =>
  import("./screens/ExecutionLogScreen").then(({ ExecutionLogScreen: Screen }) => ({
    default: Screen,
  }))
);

export function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card text-center"
    >
      <span className="size-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      <div>
        <p className="text-sm font-medium">Loading workspace</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Preparing this screen…
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<ConnectionsScreen />} />
            <Route path="/sync-config" element={<SyncConfigScreen />} />
            <Route path="/diff" element={<DiffViewScreen />} />
            <Route path="/script" element={<ScriptPreviewScreen />} />
            <Route path="/execution-log" element={<ExecutionLogScreen />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
