import { makeUci, parseUci, type Move } from "chessops";
import { positionFromFen } from "@/utils/chessops";
import type { TreeNode } from "@/utils/treeReducer";

/** Use the selected path, not the first occurrence of a repeated UCI move. */
export function puzzleMoveIndex(root: TreeNode, path: number[], moves: string[]): number | null {
    let node = root;
    for (const [ply, child] of path.entries()) {
        node = node.children[child];
        if (!node?.move || makeUci(node.move) !== moves[ply]) return null;
    }
    return path.length;
}

export function puzzleMoveResult(fen: string, moves: string[], index: number, move: Move) {
    const [pos] = positionFromFen(fen);
    if (!pos || !pos.isLegal(move) || index < 1 || index % 2 !== 1 || index >= moves.length) {
        return null;
    }
    pos.play(move);
    const mate = pos.isCheckmate();
    if (makeUci(move) !== moves[index] && !mate) return null;
    const complete = mate || index === moves.length - 1;
    return {
        complete,
        // A different mating move must be played as entered, not replaced with the stored solution.
        moves: complete ? [makeUci(move)] : [makeUci(move), moves[index + 1]],
    };
}

export function validPuzzle(fen: string, moves: string[]): boolean {
    const [pos] = positionFromFen(fen);
    // First move sets up the puzzle; the final move must belong to the solver.
    if (!pos || moves.length < 2 || moves.length % 2 !== 0) return false;
    for (const uci of moves) {
        const move = parseUci(uci);
        if (!move || !pos.isLegal(move)) return false;
        pos.play(move);
    }
    return true;
}

export function progressiveRange(rating: number): [number, number] {
    return [
        Math.min(2800, Math.max(600, rating + 50)),
        Math.min(2800, Math.max(600, rating + 100)),
    ];
}
