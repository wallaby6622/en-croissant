import { Alert, AppShell, Center, Loader, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { fontSizeAtom, nativeBarAtom, primaryColorAtom, spellCheckAtom } from "./state/atoms";
import TopBar from "./components/TopBar";
import { colorSchemeManager, createAppTheme } from "./styles/appTheme";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import "./translation/setup";
import { TreeStateContext } from "./components/common/TreeStateContext";
import GraphPanel from "./components/panels/graph/GraphPanel";
import {
  GRAPH_ACTION_EVENT,
  GRAPH_STATE_EVENT,
  type GraphSnapshot,
} from "./components/panels/graph/graphWindowSync";
import { createTreeStore } from "./state/store/tree";

const store = createTreeStore();
const parent = new URLSearchParams(window.location.search).get("parent") || "main";
const windowLabel = getCurrentWindow().label;

function DetachedGraph() {
  const isNative = useAtomValue(nativeBarAtom);
  const customTitleBar =
    !isNative &&
    (import.meta.env.VITE_PLATFORM === "win32" || import.meta.env.VITE_PLATFORM === "linux");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    let disposed = false;
    let revision = -1;
    const subscription = listen<GraphSnapshot>(GRAPH_STATE_EVENT, ({ payload }) => {
      if (disposed || payload.revision <= revision) return;
      revision = payload.revision;
      store.getState().setState(payload.tree);
      setLoaded(true);
    });
    void subscription
      .then(() => {
        if (!disposed) return emitTo(parent, GRAPH_ACTION_EVENT, { windowLabel, type: "ready" });
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    void getCurrentWindow()
      .setDecorations(!customTitleBar)
      .catch((reason) => setError(String(reason)));
  }, [customTitleBar]);
  return (
    <AppShell header={customTitleBar ? { height: "2.25rem" } : undefined}>
      {customTitleBar && (
        <AppShell.Header>
          <TopBar title={t("Board.Tabs.Graph")} />
        </AppShell.Header>
      )}
      <AppShell.Main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {error ? (
          <Alert color="red" title={t("Graph.WindowError")}>
            {error}
          </Alert>
        ) : !loaded ? (
          <Center style={{ flex: 1 }}>
            <Loader />
          </Center>
        ) : (
          <TreeStateContext.Provider value={store}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <GraphPanel
                detached
                onNavigate={(path, fen) => {
                  void emitTo(parent, GRAPH_ACTION_EVENT, {
                    windowLabel,
                    type: "navigate",
                    path,
                    fen,
                  }).catch((reason) => setError(String(reason)));
                }}
              />
            </div>
          </TreeStateContext.Provider>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

function GraphWindowApp() {
  const primaryColor = useAtomValue(primaryColorAtom);
  const spellCheck = useAtomValue(spellCheckAtom);
  const fontSize = useAtomValue(fontSizeAtom);
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);
  return (
    <MantineProvider
      defaultColorScheme="dark"
      colorSchemeManager={colorSchemeManager}
      theme={createAppTheme(primaryColor, spellCheck)}
    >
      <DetachedGraph />
    </MantineProvider>
  );
}

createRoot(document.getElementById("app")!).render(<GraphWindowApp />);
