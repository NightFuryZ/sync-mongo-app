import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ConnectionsScreen } from "./screens/ConnectionsScreen";
import { SyncConfigScreen } from "./screens/SyncConfigScreen";
import { DiffViewScreen } from "./screens/DiffViewScreen";
import { ScriptPreviewScreen } from "./screens/ScriptPreviewScreen";
import { ExecutionLogScreen } from "./screens/ExecutionLogScreen";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<ConnectionsScreen />} />
          <Route path="/sync-config" element={<SyncConfigScreen />} />
          <Route path="/diff" element={<DiffViewScreen />} />
          <Route path="/script" element={<ScriptPreviewScreen />} />
          <Route path="/execution-log" element={<ExecutionLogScreen />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
