import { Box } from "@mantine/core";
import { useElementSize, useForceUpdate } from "@mantine/hooks";
import { type Move, type NormalMove, parseSquare } from "chessops";
import { chessgroundDests, chessgroundMove } from "chessops/compat";
import { parseFen } from "chessops/fen";
import { useAtom, useAtomValue } from "jotai";
import { useContext, useRef, useState } from "react";
import { useStore } from "zustand";
import { Chessground } from "@/chessground/Chessground";
import { jumpToNextPuzzleAtom, moveHighlightAtom, showCoordinatesAtom } from "@/state/atoms";
import classes from "@/styles/Chessboard.module.css";
import { positionFromFen } from "@/utils/chessops";
import type { Completion, Puzzle } from "@/utils/puzzles";
import { getNodeAtPath } from "@/utils/treeReducer";
import { puzzleMoveIndex, puzzleMoveResult } from "./puzzleTraining";
import PromotionModal from "../boards/PromotionModal";
import { TreeStateContext } from "../common/TreeStateContext";

function PuzzleBoard({
  puzzles,
  currentPuzzle,
  changeCompletion,
  generatePuzzle,
  db,
  disabled = false,
}: {
  puzzles: Puzzle[];
  currentPuzzle: number;
  changeCompletion: (completion: Completion) => void;
  generatePuzzle: (db: string) => Promise<void>;
  db: string | null;
  disabled?: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const moveHighlight = useAtomValue(moveHighlightAtom);
  const boardShapes = useStore(store, (s) => s.currentNode().shapes);
  const makeMove = useStore(store, (s) => s.makeMove);
  const makeMoves = useStore(store, (s) => s.makeMoves);
  const reset = useForceUpdate();
  const [jumpToNextPuzzleImmediately] = useAtom(jumpToNextPuzzleAtom);

  const currentNode = getNodeAtPath(root, position);

  let puzzle: Puzzle | null = null;
  if (puzzles.length > 0) {
    puzzle = puzzles[currentPuzzle];
  }
  const checking = useRef(false);

  const [pos] = positionFromFen(currentNode.fen);

  const currentMove = puzzle ? puzzleMoveIndex(root, position, puzzle.moves) : null;
  const canMove =
    !disabled &&
    puzzle &&
    currentMove !== null &&
    currentMove > 0 &&
    currentMove % 2 === 1 &&
    currentMove < puzzle.moves.length &&
    puzzle.completion !== "correct";
  const orientation = puzzle?.fen
    ? parseFen(puzzle.fen).unwrap().turn === "white"
      ? "black"
      : "white"
    : "white";
  const [pendingMove, setPendingMove] = useState<NormalMove | null>(null);

  const dests = pos ? chessgroundDests(pos) : new Map();
  const turn = pos?.turn || "white";
  const showCoordinates = useAtomValue(showCoordinatesAtom);

  async function checkMove(move: Move) {
    if (!pos || !puzzle || !canMove || currentMove === null || checking.current) return;
    checking.current = true;
    try {
      const result = puzzleMoveResult(currentNode.fen, puzzle.moves, currentMove, move);
      if (result) {
        makeMoves({ payload: result.moves, mainline: true, changeHeaders: false });
        if (result.complete) {
          changeCompletion("correct");
          if (db && jumpToNextPuzzleImmediately) await generatePuzzle(db);
        }
      } else {
        makeMove({ payload: move, changePosition: false, changeHeaders: false });
        changeCompletion("incorrect");
      }
      reset();
    } finally {
      checking.current = false;
    }
  }

  const { ref: parentRef, height: parentHeight } = useElementSize();

  return (
    <Box w="100%" h="100%" ref={parentRef}>
      <Box
        className={classes.chessboard}
        style={{
          maxWidth: parentHeight,
        }}
      >
        <PromotionModal
          pendingMove={pendingMove}
          cancelMove={() => setPendingMove(null)}
          confirmMove={async (p) => {
            if (pendingMove) {
              await checkMove({ ...pendingMove, promotion: p });
              setPendingMove(null);
            }
          }}
          turn={turn}
          orientation={orientation}
        />
        <Chessground
          animation={{
            enabled: true,
          }}
          coordinates={showCoordinates !== "no"}
          coordinatesOnSquares={showCoordinates === "all"}
          orientation={orientation}
          drawable={{
            enabled: true,
            visible: true,
            autoShapes: boardShapes,
          }}
          movable={{
            free: false,
            color: canMove ? turn : undefined,
            dests: dests,
            events: {
              after: (orig, dest) => {
                const from = parseSquare(orig)!;
                const to = parseSquare(dest)!;
                const move: NormalMove = { from, to };
                if (
                  pos?.board.get(from)?.role === "pawn" &&
                  ((dest[1] === "8" && turn === "white") || (dest[1] === "1" && turn === "black"))
                ) {
                  setPendingMove(move);
                } else {
                  checkMove(move);
                }
              },
            },
          }}
          lastMove={
            moveHighlight && currentNode.move ? chessgroundMove(currentNode.move) : undefined
          }
          turnColor={turn}
          fen={currentNode.fen}
          check={moveHighlight && pos?.isCheck()}
        />
      </Box>
    </Box>
  );
}

export default PuzzleBoard;
