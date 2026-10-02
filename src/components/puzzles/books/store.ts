import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import {
    activeSession,
    currentAttempt,
    emptyState,
    pause,
    tick,
    type ImportReport,
    type TrainingState,
} from "./model";

interface Snapshot {
    state: TrainingState | null;
    revision: number;
    busy: boolean;
    error: string | null;
}
let snapshot: Snapshot = { state: null, revision: 0, busy: false, error: null };
const listeners = new Set<() => void>();
let queue = Promise.resolve();
let loading: Promise<void> | null = null;
function publish(next: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
}
export const getTraining = () => snapshot;
export function useTraining() {
    return useSyncExternalStore((listener) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, getTraining);
}
async function write(state: TrainingState, revision: number) {
    return invoke<number>("save_book_training", { revision, data: JSON.stringify(state) });
}
export function loadTraining(): Promise<void> {
    if (loading) return loading;
    loading = (async () => {
        publish({ busy: true, error: null });
        try {
            const raw = JSON.parse(await invoke<string>("load_book_training")) as {
                revision: number;
                state: TrainingState | null;
            };
            if (raw.state && raw.state.version !== 1)
                throw new Error("Unsupported training data version.");
            const state = raw.state ?? emptyState();
            const session = activeSession(state);
            let revision = raw.revision;
            if (session?.status === "active") {
                if (session.mode === "exam" && session.config.time !== "none")
                    tick(state, session, Date.now());
                else {
                    session.status = "paused";
                    session.interruptions++;
                    currentAttempt(session).runningSince = null;
                }
                revision = await write(state, revision);
            }
            publish({ state, revision });
        } catch (reason) {
            publish({ error: String(reason) });
        } finally {
            publish({ busy: false });
            loading = null;
        }
    })();
    return loading;
}
/** One transaction contains both the final attempt and its FSRS card/log. CAS prevents lost writes. */
export function updateTraining(action: (state: TrainingState) => void): Promise<void> {
    const run = queue.then(async () => {
        if (!snapshot.state) return;
        publish({ busy: true, error: null });
        try {
            const state = structuredClone(snapshot.state);
            action(state);
            const revision = await write(state, snapshot.revision);
            publish({ state, revision });
        } catch (reason) {
            publish({ error: String(reason) });
        } finally {
            publish({ busy: false });
        }
    });
    queue = run.catch(() => {});
    return run;
}
export function pauseTraining() {
    const session = snapshot.state && activeSession(snapshot.state);
    if (
        !session ||
        session.status !== "active" ||
        (session.mode === "exam" && session.config.time !== "none")
    )
        return Promise.resolve();
    const now = Date.now();
    return updateTraining((state) => {
        const active = activeSession(state);
        if (active) pause(state, active, now);
    });
}
export async function readBook(file: string): Promise<ImportReport> {
    return JSON.parse(await invoke<string>("import_book_puzzles", { file }));
}
