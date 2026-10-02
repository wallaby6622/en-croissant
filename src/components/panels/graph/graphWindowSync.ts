import type { TreeStoreState } from "@/state/store/tree";
import type { TreeNode, TreeState } from "@/utils/treeReducer";

export const GRAPH_STATE_EVENT = "graph-state";
export const GRAPH_ACTION_EVENT = "graph-action";
export type GraphAction = { windowLabel: string } & (
    | { type: "ready" }
    | { type: "navigate"; path: number[]; fen: string }
);
export type GraphSnapshot = { revision: number; tree: TreeState };

/** Omit engine data so analysis ticks neither serialize nor redraw a detached graph. */
export function graphTreeState(state: TreeStoreState): TreeState {
    function copy(node: TreeNode): TreeNode {
        return {
            fen: node.fen,
            san: node.san,
            move: node.move,
            halfMoves: node.halfMoves,
            comment: node.comment,
            annotations: node.annotations,
            children: [],
            score: null,
            depth: null,
            shapes: [],
        };
    }
    const root = copy(state.root);
    const pending = [{ source: state.root, target: root }];
    while (pending.length) {
        const { source, target } = pending.pop()!;
        for (const child of source.children) {
            const result = copy(child);
            target.children.push(result);
            pending.push({ source: child, target: result });
        }
    }
    return {
        root,
        headers: state.headers,
        position: state.position,
        dirty: false,
        report: { inProgress: false },
    };
}

/** Reject stale paths after deletion/promotion instead of selecting a different move. */
export function validGraphSelection(root: TreeNode, path: number[], fen: string): boolean {
    if (!Array.isArray(path)) return false;
    let node = root;
    for (const index of path) {
        if (!Number.isInteger(index) || index < 0 || !node.children[index]) return false;
        node = node.children[index];
    }
    return node.fen === fen;
}
