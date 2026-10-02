import { expect, test, vi } from "vitest";
import { memoize } from "proxy-memoize";
import { createTreeStore } from "@/state/store/tree";
import { labelOpenings } from "./useOpeningNames";
import { collectGraphNodes, computeLayout, positionKey, graphNodeHeight } from "./graphLayout";
import { graphTreeState, validGraphSelection } from "./graphWindowSync";
import { branchColors } from "./branchColors";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));

function london() {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: ["d4", "d5", "Bf4", "Nf6"] });
    store.getState().goToMove([0, 0, 0]);
    store.getState().makeMoves({ payload: ["c5"] });
    return store;
}

test("opening labels appear at their defining move and carry into forks without labelling every move", () => {
    const nodes = collectGraphNodes(london().getState().root);
    const defining = nodes.find((node) => node.data.move === "2. Bf4")!;
    const counter = nodes.find((node) => node.data.move === "2... c5")!;
    const named = labelOpenings(
        nodes,
        new Map([
            [positionKey(defining.data.fen), "Queen's Pawn Game: Accelerated London System"],
            [positionKey(counter.data.fen), "Accelerated London System, Steinitz Countergambit"],
        ]),
    );
    expect(named.find((node) => node.id === defining.id)?.data.openingName).toContain(
        "Accelerated London",
    );
    expect(named.find((node) => node.data.move === "2... Nf6")?.data.openingName).toContain(
        "Accelerated London",
    );
    expect(named.find((node) => node.id === counter.id)?.data.openingName).toContain(
        "Countergambit",
    );
    expect(named.find((node) => node.data.move === "1. d4")?.data.openingName).toBeUndefined();
    const layout = computeLayout(named, new Set(), true);
    const forkNodes = layout.nodes.filter((node) => node.data.path.length === 4);
    const [first, second] = forkNodes.sort((a, b) => a.position.y - b.position.y);
    expect(first.position.y + graphNodeHeight(first)).toBeLessThan(second.position.y);
});

test("detached snapshots ignore engine updates but include comments, moves, and navigation", () => {
    const store = london();
    const select = memoize(graphTreeState);
    const first = select(store.getState());
    store.getState().setScore({ value: { type: "cp", value: 42 }, wdl: null });
    expect(select(store.getState())).toBe(first);
    store.getState().setComment("Countergambit idea");
    const changed = select(store.getState());
    expect(changed).not.toBe(first);
    expect(JSON.stringify(changed)).toContain("Countergambit idea");
    store.getState().goToMove([]);
    expect(select(store.getState()).position).toEqual([]);
    store.getState().makeMoves({ payload: ["e4"] });
    const latest = select(store.getState());
    expect(latest.root.children).toHaveLength(2);
    expect(latest.root).not.toBe(store.getState().root);
    expect(latest.dirty).toBe(false);
});

test("branch identity continues through unlabeled moves and changes only with a new opening name", () => {
    const store = london();
    store.getState().goToMove([0, 0, 0, 0]);
    store.getState().makeMoves({ payload: ["e3"] });
    const nodes = collectGraphNodes(store.getState().root);
    const defining = nodes.find((node) => node.data.move === "2. Bf4")!;
    const counter = nodes.find((node) => node.data.move === "2... c5")!;
    const named = labelOpenings(
        nodes,
        new Map([
            [positionKey(defining.data.fen), "Accelerated London System"],
            [positionKey(counter.data.fen), "Steinitz Countergambit"],
        ]),
    );
    const continuation = named.find((node) => node.data.move === "3. e3")!;
    expect(continuation.data.openingName).toBeUndefined();
    expect(continuation.data.branchName).toBe("Accelerated London System");
    expect(named.find((node) => node.id === counter.id)?.data.branchName).toBe(
        "Steinitz Countergambit",
    );
    expect(named[0].data.branchName).toBeUndefined();
    expect(named.find((node) => node.id === defining.id)?.data.branchName).toBe(
        continuation.data.branchName,
    );
    const folded = computeLayout(named, new Set([defining.id]), true);
    expect(folded.nodes.find((node) => node.id === defining.id)?.data.branchName).toBe(
        continuation.data.branchName,
    );
});

test.each(["light", "dark"] as const)(
    "%s branch colors never repeat, including RGB rounding collisions in large repertoires",
    (theme) => {
        const names = Array.from({ length: 4096 }, (_, index) => `Opening ${index}`);
        const colors = branchColors(names, theme);
        expect(colors.size).toBe(names.length);
        expect(new Set(colors.values()).size).toBe(names.length);
        expect([...colors.values()].every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
        // Independent windows and duplicate labels must produce exactly the same mapping.
        expect(branchColors([...names].reverse().concat(names.slice(0, 100)), theme)).toEqual(
            colors,
        );
    },
);

test("detached selection rejects removed branches and mismatched FENs", () => {
    const store = london();
    const node = store.getState().currentNode();
    const path = [...store.getState().position];
    expect(validGraphSelection(store.getState().root, path, node.fen)).toBe(true);
    expect(validGraphSelection(store.getState().root, [-1], node.fen)).toBe(false);
    expect(validGraphSelection(store.getState().root, [0.5], node.fen)).toBe(false);
    expect(validGraphSelection(store.getState().root, path, "different position")).toBe(false);
    store.getState().deleteMove(path);
    expect(validGraphSelection(store.getState().root, path, node.fen)).toBe(false);
});
