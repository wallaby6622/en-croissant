import { useCallback, useEffect, useMemo, useState } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getDefaultStore } from "jotai";
import { nativeBarAtom } from "@/state/atoms";
import { memoize } from "proxy-memoize";
import type { TreeStore } from "@/state/store/tree";
import {
    GRAPH_ACTION_EVENT,
    GRAPH_STATE_EVENT,
    graphTreeState,
    validGraphSelection,
    type GraphAction,
} from "./graphWindowSync";

export function useGraphWindow(store: TreeStore) {
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const controller = useMemo(() => {
        let child: WebviewWindow | null = null;
        let pending: Promise<void> | null = null;
        let disposed = false;
        let ready = false;
        let revision = 0;
        let unlisten: UnlistenFn | undefined;
        let unsubscribe: (() => void) | undefined;
        let frame: number | undefined;
        const select = memoize(graphTreeState);
        let previous = select(store.getState());
        function clear() {
            unlisten?.();
            unlisten = undefined;
            unsubscribe?.();
            unsubscribe = undefined;
            if (frame !== undefined) cancelAnimationFrame(frame);
            frame = undefined;
            child = null;
            ready = false;
            if (!disposed) setIsOpen(false);
        }
        function publish() {
            if (!child || !ready) return;
            void emitTo(child.label, GRAPH_STATE_EVENT, {
                revision: ++revision,
                tree: select(store.getState()),
            }).catch((reason) => {
                if (!disposed) setError(String(reason));
            });
        }
        async function create(title: string) {
            setError(null);
            if (child) {
                await child.setFocus();
                return;
            }
            const label = `graph-${crypto.randomUUID()}`;
            unlisten = await listen<GraphAction>(GRAPH_ACTION_EVENT, ({ payload }) => {
                if (payload.windowLabel !== label || disposed) return;
                if (payload.type === "ready") {
                    ready = true;
                    setIsOpen(true);
                    publish();
                }
                if (payload.type === "navigate") {
                    if (validGraphSelection(store.getState().root, payload.path, payload.fen))
                        store.getState().goToMove(payload.path);
                    publish();
                }
            });
            if (disposed) {
                clear();
                return;
            }
            const params = new URLSearchParams({ parent: getCurrentWindow().label });
            child = new WebviewWindow(label, {
                url: `graph.html?${params}`,
                title,
                width: 1000,
                height: 700,
                minWidth: 480,
                minHeight: 320,
                resizable: true,
                decorations:
                    getDefaultStore().get(nativeBarAtom) ||
                    (import.meta.env.VITE_PLATFORM !== "win32" &&
                        import.meta.env.VITE_PLATFORM !== "linux"),
            });
            const window = child;
            previous = select(store.getState());
            unsubscribe = store.subscribe((state) => {
                const next = select(state);
                if (next === previous) return;
                previous = next;
                if (frame !== undefined) cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => {
                    frame = undefined;
                    publish();
                });
            });
            await new Promise<void>((resolve, reject) => {
                void window.once("tauri://created", () => resolve());
                void window.once("tauri://error", ({ payload }) => {
                    clear();
                    reject(new Error(String(payload)));
                });
            });
            if (disposed) {
                await window.destroy();
                clear();
                return;
            }
            await window.once("tauri://destroyed", () => {
                if (child === window) clear();
            });
        }
        return {
            open(title: string) {
                if (!pending)
                    pending = create(title)
                        .catch((reason) => {
                            if (!disposed) setError(String(reason));
                        })
                        .finally(() => {
                            pending = null;
                        });
                return pending;
            },
            dispose() {
                disposed = true;
                const window = child;
                clear();
                if (window) void window.destroy().catch(() => {});
            },
        };
    }, [store]);
    useEffect(() => () => controller.dispose(), [controller]);
    const open = useCallback((title: string) => controller.open(title), [controller]);
    return { open, error, isOpen };
}
