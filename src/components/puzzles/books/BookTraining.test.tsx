import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { invoke } from "@tauri-apps/api/core";
import type { Config } from "@lichess-org/chessground/config";
import BookTraining from "./BookTraining";
import { emptyState, importBook, masteryDefaults, startSession, type TrainingState } from "./model";
import { getTraining, loadTraining, updateTraining } from "./store";

const mocks = vi.hoisted(() => ({
  board: {} as Config,
  onClose: null as null | ((event: { preventDefault: () => void }) => Promise<void>),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof mocks.onClose) => {
      mocks.onClose = handler;
      return () => {};
    },
    close: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock("@/chessground/Chessground", () => ({
  Chessground: (props: Config) => {
    mocks.board = props;
    return <div data-testid="board" />;
  },
}));
vi.mock("../../boards/PromotionModal", () => ({ default: () => null }));
let root: Root | null = null;
let persisted: { revision: number; state: TrainingState };
let failSave = false;
let clock = 100000;
function source() {
  const state = emptyState();
  importBook(state, {
    book: { id: "book", title: "Example book", edition: "SECRET EDITION" },
    problems: [
      {
        id: "p1",
        order: 1,
        chapter: "SECRET CHAPTER",
        number: "SECRET NUMBER",
        page: "10",
        answerPage: "20",
        fen: INITIAL_FEN,
        prompt: "Public prompt",
        examPrompt: "Neutral prompt",
        hints: ["SECRET HINT"],
        explanation: "SECRET SOLUTION",
        themes: ["SECRET THEME"],
        solution: [{ uci: "e2e4", comment: "SECRET MOVE COMMENT", children: [] }],
      },
    ],
  });
  return state;
}
const button = (label: string) => {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
};
async function click(label: string) {
  await act(async () => button(label).click());
}
async function mount() {
  await loadTraining();
  document.body.innerHTML =
    '<div id="left"></div><div id="topRight"></div><div id="bottomRight"></div>';
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () =>
    root!.render(
      <MantineProvider env="test">
        <BookTraining onBack={() => {}} />
      </MantineProvider>,
    ),
  );
}
async function move(from: string, to: string) {
  await act(async () => {
    mocks.board.movable?.events?.after?.(from as never, to as never, {} as never);
  });
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
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  clock = 100000;
  failSave = false;
  persisted = { revision: 0, state: source() };
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === "load_book_training") return JSON.stringify(persisted);
    if (name === "save_book_training") {
      if (failSave) throw new Error("disk full");
      const input = args as { revision: number; data: string };
      if (input.revision !== persisted.revision) throw new Error("stale writer");
      persisted = { revision: persisted.revision + 1, state: JSON.parse(input.data) };
      return persisted.revision;
    }
    throw new Error(`Unexpected invoke: ${name}`);
  });
});
afterEach(async () => {
  if (root)
    await act(async () => {
      root!.unmount();
    });
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("Exam hides metadata, hints, answers and comments until the exam ends", async () => {
  const session = startSession(
    persisted.state,
    "book",
    "exam",
    { ...masteryDefaults, count: 1 },
    clock,
  );
  session.status = "paused";
  await mount();
  expect(document.body.textContent).not.toContain("Neutral prompt");
  await click("Resume");
  expect(document.body.textContent).toContain("Neutral prompt");
  for (const secret of [
    "SECRET NUMBER",
    "SECRET CHAPTER",
    "SECRET THEME",
    "SECRET SOLUTION",
    "SECRET HINT",
    "SECRET MOVE COMMENT",
  ])
    expect(document.body.textContent).not.toContain(secret);
  expect(button("Puzzle.GetAHint").disabled).toBe(true);
  expect(button("Puzzle.ViewSolution").disabled).toBe(true);
  clock += 2000;
  await move("e2", "e4");
  expect(persisted.state.sessions[0].status).toBe("complete");
  expect(persisted.state.cards).toEqual({});
  expect(persisted.state.logs).toEqual([]);
  const expand = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("SECRET NUMBER"),
  )!;
  await act(async () => expand.click());
  expect(document.body.textContent).toContain("SECRET SOLUTION");
});

test("pause hides the question and board; resume preserves a failed learning attempt", async () => {
  const session = startSession(persisted.state, "book", "learn", masteryDefaults, clock);
  session.status = "paused";
  await mount();
  await click("Resume");
  clock += 1000;
  await move("d2", "d4");
  expect(persisted.state.logs).toHaveLength(0);
  await click("Pause");
  expect(document.querySelector('[data-testid="board"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Public prompt");
  clock += 5000;
  await click("Resume");
  clock += 1000;
  await move("e2", "e4");
  expect(persisted.state.logs.map((log) => log.grade)).toEqual(["Again"]);
  expect(persisted.state.sessions[0].attempts[0].elapsedMs).toBe(2000);
});

test("Reveal finalizes an allowed exam as incorrect without touching SRS", async () => {
  const session = startSession(
    persisted.state,
    "book",
    "exam",
    { ...masteryDefaults, count: 1, reveal: true },
    clock,
  );
  session.status = "paused";
  await mount();
  await click("Resume");
  await click("Puzzle.ViewSolution");
  expect(document.body.textContent).toContain("SECRET SOLUTION");
  expect(persisted.state.sessions[0].attempts[0].result).toBe("reveal");
  expect(persisted.state.cards).toEqual({});
  await click("Continue");
  expect(persisted.state.sessions[0].status).toBe("complete");
});

test("small sources require explicit exam-size adjustment", async () => {
  await mount();
  await act(async () =>
    (document.querySelector('input[value="exam"]') as HTMLInputElement).click(),
  );
  expect(button("Start").disabled).toBe(true);
  await click("Use all available problems");
  expect(button("Start").disabled).toBe(false);
  await click("Start");
  expect(persisted.state.sessions[0].attempts).toHaveLength(1);
});

test("a failed finalization keeps both card and result unchanged and stops gameplay", async () => {
  const session = startSession(persisted.state, "book", "learn", masteryDefaults, clock);
  session.status = "paused";
  await mount();
  await click("Resume");
  failSave = true;
  await move("e2", "e4");
  expect(persisted.state.cards).toEqual({});
  expect(persisted.state.sessions[0].attempts[0].result).toBeNull();
  expect(document.body.textContent).toContain("disk full");
  expect(mocks.board.movable?.color).toBeUndefined();
  failSave = false;
  await click("Reload saved progress");
  await click("Resume");
  await move("e2", "e4");
  expect(persisted.state.logs).toHaveLength(1);
});

test("storage serializes concurrent writes and rejects stale revisions without losing saved data", async () => {
  await loadTraining();
  await Promise.all([
    updateTraining((data) => {
      data.settings.newPerDay = 5;
    }),
    updateTraining((data) => {
      data.settings.retention = 0.95;
    }),
  ]);
  expect(persisted.state.settings).toMatchObject({ newPerDay: 5, retention: 0.95 });
  persisted.revision++;
  await updateTraining((data) => {
    data.settings.newPerDay = 99;
  });
  expect(getTraining().error).toContain("stale writer");
  expect(persisted.state.settings.newPerDay).toBe(5);
});
