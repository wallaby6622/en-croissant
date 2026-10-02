import { expect, test, vi } from "vitest";
import { memoize } from "proxy-memoize";
import { createTreeStore, type TreeStoreState } from "@/state/store/tree";
import { defaultTree } from "@/utils/treeReducer";
import { collectGraphNodes, computeLayout, graphNodeId, positionKey } from "./graphLayout";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));

function opening() {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: ["Nf3", "d5", "d4", "Nf6"] });
    store.getState().goToStart();
    store.getState().makeMoves({ payload: ["d4", "d5", "Nf3", "e6"] });
    return store;
}

test("both transposing PGN paths and their different continuations remain navigable", () => {
    const store = opening();
    const before = JSON.stringify(store.getState().root);
    const all = collectGraphNodes(store.getState().root);
    const { nodes, edges } = computeLayout(all, new Set(), true);
    expect(nodes).toHaveLength(9);
    expect(edges.filter((e) => e.data?.isTransposition)).toHaveLength(1);
    for (const node of nodes) {
        store.getState().goToMove(node.data.path);
        expect(store.getState().currentNode().fen).toBe(node.data.fen);
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
    }
    expect(JSON.stringify(store.getState().root)).toBe(before);
    expect(all.every((node) => node.position.x === 0 && node.position.y === 0)).toBe(true);
});

test("collapse removes only descendants and leaves no dangling edges", () => {
    const all = collectGraphNodes(opening().getState().root);
    const collapsed = computeLayout(all, new Set([graphNodeId([0])]), true);
    expect(collapsed.nodes).toHaveLength(6);
    const ids = new Set(collapsed.nodes.map((n) => n.id));
    expect(collapsed.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(computeLayout(all, new Set([graphNodeId([])]), true).nodes).toHaveLength(1);
    expect(computeLayout(all, new Set(), false).edges).toHaveLength(8);
});

test("repeated root positions produce finite layouts without introducing Dagre cycles", () => {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: ["Nf3", "Nf6", "Ng1", "Ng8"] });
    const graph = computeLayout(collectGraphNodes(store.getState().root), new Set(), true);
    const link = graph.edges.find((e) => e.data?.isTransposition);
    expect(link?.target).toBe("root");
    expect(link?.data?.graphBottom).toBeGreaterThan(0);
    expect(graph.nodes).toHaveLength(5);
});

test("position identity ignores clocks but preserves turn, castling, and en-passant rights", () => {
    const fen = defaultTree().root.fen;
    expect(positionKey(fen)).toBe(positionKey(fen.replace("0 1", "8 5")));
    expect(positionKey(fen)).not.toBe(positionKey(fen.replace(" w ", " b ")));
    expect(positionKey(fen)).not.toBe(positionKey(fen.replace("KQkq", "KQ")));
    expect(positionKey(fen)).not.toBe(positionKey(fen.replace(" - ", " e3 ")));
});

test("graph selector ignores evaluation updates and responds to added branches", () => {
    const store = opening();
    const select = memoize((s: TreeStoreState) => collectGraphNodes(s.root));
    const before = select(store.getState());
    store.getState().setScore({ value: { type: "cp", value: 30 }, wdl: null });
    expect(select(store.getState())).toBe(before);
    store.getState().makeMoves({ payload: ["c4"] });
    expect(select(store.getState())).toHaveLength(before.length + 1);
});

test("root-only and custom black-to-move positions render correctly", () => {
    expect(computeLayout(collectGraphNodes(defaultTree().root), new Set(), true).edges).toEqual([]);
    const store = createTreeStore(
        undefined,
        defaultTree(defaultTree().root.fen.replace(" w ", " b ")),
    );
    store.getState().makeMoves({ payload: ["e5"] });
    expect(collectGraphNodes(store.getState().root)[1].data.move).toBe("1... e5");
});
