import { expect, test, vi } from "vitest";
import { parseUci } from "chessops";
import { INITIAL_FEN } from "chessops/fen";
import { createTreeStore } from "@/state/store/tree";
import { puzzleMoveIndex, puzzleMoveResult, validPuzzle } from "./puzzleTraining";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));

test("repeated UCI moves use their actual ply and variations cannot request solution hints", () => {
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "d7d5"];
    const tree = createTreeStore();
    tree.getState().makeMoves({ payload: moves.slice(0, 5) });
    expect(puzzleMoveIndex(tree.getState().root, tree.getState().position, moves)).toBe(5);
    tree.getState().makeMoves({ payload: ["e7e5"] });
    expect(puzzleMoveIndex(tree.getState().root, tree.getState().position, moves)).toBeNull();
    expect(puzzleMoveIndex(tree.getState().root, [99], moves)).toBeNull();
});

test("an alternative checkmate finishes immediately and preserves the submitted move", () => {
    const fen = "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1";
    const result = puzzleMoveResult(fen, ["h7h8", "g6g7", "h8h7", "g7g8"], 1, parseUci("g6g8")!);
    expect(result).toEqual({ complete: true, moves: ["g6g8"] });
});

test("correct intermediate moves include the reply, and wrong or illegal moves are rejected", () => {
    const tree = createTreeStore();
    tree.getState().makeMoves({ payload: ["e2e4"] });
    const fen = tree.getState().currentNode().fen;
    const moves = ["e2e4", "e7e5", "g1f3", "b8c6"];
    expect(puzzleMoveResult(fen, moves, 1, parseUci("e7e5")!)).toEqual({
        complete: false,
        moves: ["e7e5", "g1f3"],
    });
    expect(puzzleMoveResult(fen, moves, 1, parseUci("d7d5")!)).toBeNull();
    expect(puzzleMoveResult(fen, moves, 1, parseUci("e7e4")!)).toBeNull();
    expect(puzzleMoveResult(fen, moves, 2, parseUci("e7e5")!)).toBeNull();
});

test("puzzle validation rejects broken FEN, moves and incomplete solutions", () => {
    expect(validPuzzle(INITIAL_FEN, ["e2e4", "e7e5"])).toBe(true);
    expect(validPuzzle("bad", ["e2e4", "e7e5"])).toBe(false);
    expect(validPuzzle(INITIAL_FEN, ["e2e4"])).toBe(false);
    expect(validPuzzle(INITIAL_FEN, ["e2e4", "e7e4"])).toBe(false);
    expect(validPuzzle(INITIAL_FEN, [])).toBe(false);
});
