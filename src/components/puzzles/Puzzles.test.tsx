import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { commands } from "@/bindings";
import {
  activeTabAtom,
  tabsAtom,
  currentPuzzleAtom,
  currentPuzzleTimerAtom,
  selectedPuzzleDbAtom,
  trackPuzzleTimeAtom,
  jumpToNextPuzzleAtom,
  progressivePuzzlesAtom,
  puzzleRatingRangeAtom,
} from "@/state/atoms";
import { createTreeStore } from "@/state/store/tree";
import { TreeStateContext } from "../common/TreeStateContext";
import Puzzles from "./Puzzles";
import type { Config } from "@lichess-org/chessground/config";
import type { Puzzle } from "@/utils/puzzles";

const mocks = vi.hoisted(() => ({ board: {} as Config }));
vi.mock("@/bindings", () => ({
  commands: {
    getPuzzle: vi.fn(),
    getPuzzleThemes: vi.fn(),
    getThemesForPuzzle: vi.fn(),
    deletePuzzleDatabase: vi.fn(),
  },
}));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/utils/puzzles", async (original) => ({
  ...(await original<typeof import("@/utils/puzzles")>()),
  getPuzzleDatabases: async () => [
    { title: "A", path: "a.db3", puzzleCount: 2, storageSize: 1, description: "" },
    { title: "B", path: "b.db3", puzzleCount: 2, storageSize: 1, description: "" },
  ],
}));
vi.mock("@/chessground/Chessground", () => ({
  Chessground: (props: Config) => {
    mocks.board = props;
    return null;
  },
}));
vi.mock("./AddPuzzle", () => ({ default: () => null }));
vi.mock("../boards/PromotionModal", () => ({ default: () => null }));
vi.mock("../common/GameNotation", () => ({ default: () => null }));
vi.mock("../common/MoveControls", () => ({ default: () => null }));

let root: Root;
let element: HTMLDivElement;
let atoms: ReturnType<typeof createStore>;
let tree: ReturnType<typeof createTreeStore>;
const record = {
  id: 1,
  fen: INITIAL_FEN,
  moves: "e2e4 e7e5 g1f3 b8c6",
  rating: 1200,
  rating_deviation: 0,
  popularity: 0,
  nb_plays: 0,
};
const history = (): Puzzle[] => JSON.parse(sessionStorage.getItem("test-puzzles") || "[]");
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label || el.textContent === label,
  );
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}
async function move(from: string, to: string) {
  await act(async () => {
    mocks.board.movable?.events?.after?.(from as never, to as never, {} as never);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount() {
  element = document.createElement("div");
  document.body.innerHTML =
    '<div id="left"></div><div id="topRight"></div><div id="bottomRight"></div>';
  document.body.append(element);
  root = createRoot(element);
  await act(async () =>
    root.render(
      <Provider store={atoms}>
        <MantineProvider env="test">
          <TreeStateContext.Provider value={tree}>
            <Puzzles id="test" />
          </TreeStateContext.Provider>
        </MantineProvider>
      </Provider>,
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(commands.getPuzzle).mockResolvedValue({ status: "ok", data: record });
  vi.mocked(commands.getPuzzleThemes).mockResolvedValue({ status: "ok", data: ["fork"] });
  vi.mocked(commands.getThemesForPuzzle).mockResolvedValue({ status: "ok", data: ["fork"] });
  atoms = createStore();
  atoms.set(tabsAtom, [{ ...atoms.get(tabsAtom)[0], value: "test", type: "puzzles" }]);
  atoms.set(activeTabAtom, "test");
  atoms.set(selectedPuzzleDbAtom, "a.db3");
  atoms.set(trackPuzzleTimeAtom, true);
  atoms.set(jumpToNextPuzzleAtom, false);
  tree = createTreeStore();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("empty and cleared sessions cannot open analysis", async () => {
  await mount();
  expect(button("Puzzle.AnalyzePosition").disabled).toBe(true);
  await click("Puzzle.NewPuzzle");
  expect(button("Puzzle.AnalyzePosition").disabled).toBe(false);
  await click("Puzzle.ClearSession");
  expect(button("Puzzle.AnalyzePosition").disabled).toBe(true);
  expect(atoms.get(currentPuzzleAtom)).toBe(0);
  expect(tree.getState().position).toEqual([]);
});

test("clearing a session discards an in-flight puzzle response", async () => {
  const pending = deferred<Awaited<ReturnType<typeof commands.getPuzzle>>>();
  vi.mocked(commands.getPuzzle).mockReturnValue(pending.promise);
  await mount();
  await click("Puzzle.NewPuzzle");
  expect(button("Puzzle.NewPuzzle").disabled).toBe(true);
  await click("Puzzle.ClearSession");
  await act(async () => pending.resolve({ status: "ok", data: record }));
  expect(history()).toEqual([]);
  expect(tree.getState().position).toEqual([]);
});

test("switching databases discards an in-flight puzzle response", async () => {
  const pending = deferred<Awaited<ReturnType<typeof commands.getPuzzle>>>();
  vi.mocked(commands.getPuzzle).mockReturnValue(pending.promise);
  await mount();
  await click("Puzzle.NewPuzzle");
  await act(async () => atoms.set(selectedPuzzleDbAtom, "b.db3"));
  await act(async () => pending.resolve({ status: "ok", data: record }));
  expect(history()).toEqual([]);
  expect(button("Puzzle.NewPuzzle").disabled).toBe(false);
});

test("no-results and rejected requests are displayed and can be retried", async () => {
  vi.mocked(commands.getPuzzle)
    .mockResolvedValueOnce({ status: "error", error: "No puzzles" })
    .mockRejectedValueOnce(new Error("offline"));
  await mount();
  await click("Puzzle.NewPuzzle");
  expect(document.body.textContent).toContain("No puzzles");
  await click("Puzzle.NewPuzzle");
  expect(document.body.textContent).toContain("offline");
  await click("Puzzle.NewPuzzle");
  expect(history()).toHaveLength(1);
});

test("malformed puzzle data leaves the board and history intact", async () => {
  vi.mocked(commands.getPuzzle).mockResolvedValueOnce({
    status: "ok",
    data: { ...record, moves: "e2e9" },
  });
  await mount();
  await click("Puzzle.NewPuzzle");
  expect(history()).toEqual([]);
  expect(tree.getState().position).toEqual([]);
  expect(document.body.textContent).toContain("Puzzle.InvalidData");
});

test("an incorrect answer stays incorrect after retrying the whole solution", async () => {
  await mount();
  await click("Puzzle.NewPuzzle");
  await move("d7", "d5");
  expect(history()[0].completion).toBe("incorrect");
  expect(tree.getState().position).toEqual([0]);
  await move("e7", "e5");
  await move("b8", "c6");
  expect(history()[0].completion).toBe("incorrect");
  expect(tree.getState().position).toEqual([0, 0, 0, 0]);
});

test("correct completion advances immediately without waiting for theme metadata", async () => {
  const pending = deferred<Awaited<ReturnType<typeof commands.getThemesForPuzzle>>>();
  vi.mocked(commands.getThemesForPuzzle).mockReturnValue(pending.promise);
  atoms.set(jumpToNextPuzzleAtom, true);
  await mount();
  await click("Puzzle.NewPuzzle");
  await move("e7", "e5");
  await move("b8", "c6");
  expect(history()).toHaveLength(2);
  expect(history()[0].completion).toBe("correct");
  expect(history()[1].completion).toBe("incomplete");
  await click("Puzzle.ClearSession");
  await click("Puzzle.NewPuzzle");
  await act(async () => pending.resolve({ status: "ok", data: ["old-theme"] }));
  expect(history()[0].themes).toBeUndefined();
});

test("clearing a session cancels solution playback", async () => {
  vi.useFakeTimers();
  await mount();
  await click("Puzzle.NewPuzzle");
  await click("Puzzle.ViewSolution");
  expect(mocks.board.movable?.color).toBeUndefined();
  await click("Puzzle.ClearSession");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(history()).toEqual([]);
  expect(tree.getState().position).toEqual([]);
});

test("time tracking pauses when disabled and resumes accumulated time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  await mount();
  await click("Puzzle.NewPuzzle");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => atoms.set(trackPuzzleTimeAtom, false));
  expect(history()[0].timeSpent).toBe(2000);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  await act(async () => {
    atoms.set(currentPuzzleTimerAtom, null);
    atoms.set(trackPuzzleTimeAtom, true);
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await move("e7", "e5");
  await move("b8", "c6");
  expect(history()[0].timeSpent).toBe(3000);
});

test("progressive mode stays inside supported rating bounds", async () => {
  atoms.set(progressivePuzzlesAtom, true);
  vi.mocked(commands.getPuzzle).mockResolvedValue({
    status: "ok",
    data: { ...record, rating: 2790 },
  });
  await mount();
  await click("Puzzle.NewPuzzle");
  await click("Puzzle.NewPuzzle");
  expect(commands.getPuzzle).toHaveBeenLastCalledWith("a.db3", 2800, 2800, null);
  expect(atoms.get(puzzleRatingRangeAtom)).toEqual([2800, 2800]);
});

test("leaving a puzzle tab preserves elapsed time without counting time away", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  await mount();
  await click("Puzzle.NewPuzzle");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => root.unmount());
  expect(history()[0].timeSpent).toBe(2000);
  expect(atoms.get(currentPuzzleTimerAtom)).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await move("e7", "e5");
  await move("b8", "c6");
  expect(history()[0].timeSpent).toBe(3000);
});

test("completion uses the puzzle's source database even after changing the selection", async () => {
  await mount();
  await click("Puzzle.NewPuzzle");
  await act(async () => atoms.set(selectedPuzzleDbAtom, "b.db3"));
  await move("e7", "e5");
  await move("b8", "c6");
  expect(commands.getThemesForPuzzle).toHaveBeenCalledWith("a.db3", record.id);
});

test("hint after a repeated move points to the actual next move and remains incorrect", async () => {
  vi.mocked(commands.getPuzzle).mockResolvedValue({
    status: "ok",
    data: { ...record, moves: "g1f3 g8f6 f3g1 f6g8 g1f3 d7d5" },
  });
  await mount();
  await click("Puzzle.NewPuzzle");
  await move("g8", "f6");
  await move("f6", "g8");
  await click("Puzzle.GetAHint");
  expect(tree.getState().currentNode().shapes).toEqual([
    { orig: "d7", brush: "green", dest: undefined },
  ]);
  await click("Puzzle.GetAHint");
  expect(tree.getState().currentNode().shapes).toEqual([
    { orig: "d7", dest: "d5", brush: "green" },
  ]);
  await click("Puzzle.GetAHint");
  expect(tree.getState().currentNode().shapes).toEqual([]);
  await move("d7", "d5");
  expect(history()[0].completion).toBe("incorrect");
});

test("a stale theme lookup cannot replace the new database's available themes", async () => {
  const pending = deferred<Awaited<ReturnType<typeof commands.getPuzzleThemes>>>();
  vi.mocked(commands.getPuzzleThemes).mockReturnValueOnce(pending.promise);
  await mount();
  expect(button("Puzzle.NewPuzzle").disabled).toBe(true);
  await act(async () => atoms.set(selectedPuzzleDbAtom, "b.db3"));
  expect(button("Puzzle.NewPuzzle").disabled).toBe(false);
  await act(async () => pending.resolve({ status: "error", error: "stale error" }));
  expect(document.body.textContent).not.toContain("stale error");
});

test("a failed database deletion keeps the selected database and session available", async () => {
  vi.mocked(commands.deletePuzzleDatabase).mockResolvedValue({
    status: "error",
    error: "permission denied",
  });
  await mount();
  await click("Puzzle.NewPuzzle");
  await click("Delete database");
  await click("Common.Delete");
  expect(history()).toHaveLength(1);
  expect(atoms.get(selectedPuzzleDbAtom)).toBe("a.db3");
  expect(document.body.textContent).toContain("permission denied");
  expect(button("Puzzle.NewPuzzle").disabled).toBe(false);
});

test("leaving one tab cannot reset another tab's puzzle timer", async () => {
  await mount();
  await click("Puzzle.NewPuzzle");
  const other = { ...atoms.get(tabsAtom)[0], value: "other" };
  await act(async () => {
    atoms.set(tabsAtom, [...atoms.get(tabsAtom), other]);
    atoms.set(activeTabAtom, "other");
    atoms.set(currentPuzzleTimerAtom, 1234);
    atoms.set(currentPuzzleAtom, 7);
  });
  await act(async () => root.unmount());
  expect(atoms.get(currentPuzzleTimerAtom)).toBe(1234);
  expect(atoms.get(currentPuzzleAtom)).toBe(7);
});
