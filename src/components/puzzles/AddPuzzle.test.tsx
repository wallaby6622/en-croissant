import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import { commands } from "@/bindings";
import AddPuzzle from "./AddPuzzle";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/bindings", () => ({
  commands: { downloadFile: vi.fn(), clearProgress: vi.fn(), getProgress: vi.fn() },
  events: { progressEvent: { listen: async () => () => {} } },
}));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...parts: string[]) => parts.join("/") }));
vi.mock("@/utils/directories", () => ({ getPuzzlesDir: async () => "/puzzles" }));
vi.mock("@/utils/db", () => ({
  getDefaultPuzzleDatabases: async () => [
    {
      title: "Test puzzles",
      path: "",
      description: "",
      puzzleCount: 20,
      storageSize: 1,
      downloadLink: "https://example.invalid/puzzles.db3",
    },
  ],
}));
vi.mock("@/utils/puzzles", () => ({
  getPuzzleDatabases: async () => [{ title: "Test puzzles", path: "/puzzles/Test puzzles.db3" }],
}));
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

test("a failed download clears stuck progress and allows retry", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
  vi.mocked(commands.getProgress).mockResolvedValue(null);
  vi.mocked(commands.clearProgress).mockResolvedValue(undefined);
  vi.mocked(commands.downloadFile)
    .mockResolvedValueOnce({ status: "error", error: "download failed" })
    .mockResolvedValueOnce({ status: "ok", data: null });
  const setPuzzleDbs = vi.fn();
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MantineProvider env="test">
          <AddPuzzle opened setOpened={() => {}} puzzleDbs={[]} setPuzzleDbs={setPuzzleDbs} />
        </MantineProvider>
      </SWRConfig>,
    ),
  );
  const install = () =>
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Common.Install",
    )!;
  await act(async () => install().click());
  expect(document.body.textContent).toContain("download failed");
  expect(commands.clearProgress).toHaveBeenCalledWith("puzzle_db_0");
  expect(install().disabled).toBe(false);
  expect(setPuzzleDbs).not.toHaveBeenCalled();
  await act(async () => install().click());
  expect(commands.downloadFile).toHaveBeenCalledTimes(2);
  expect(setPuzzleDbs).toHaveBeenCalledWith([
    { title: "Test puzzles", path: "/puzzles/Test puzzles.db3" },
  ]);
});
