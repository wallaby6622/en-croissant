import { Box, Paper, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { makeUci, parseSquare, type NormalMove } from "chessops";
import { chessgroundDests } from "chessops/compat";
import { Chessground } from "@/chessground/Chessground";
import { positionFromFen } from "@/utils/chessops";
import classes from "@/styles/Chessboard.module.css";
import PromotionModal from "../../boards/PromotionModal";
import { useTranslation } from "react-i18next";

export default function BookBoard({
  fen,
  orientation,
  disabled,
  hidden,
  onMove,
  hint,
}: {
  fen: string;
  orientation: "white" | "black";
  disabled: boolean;
  hidden: boolean;
  onMove: (uci: string) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [pos] = positionFromFen(fen);
  const [pending, setPending] = useState<NormalMove | null>(null);
  const { ref, width, height } = useElementSize();
  useEffect(() => setPending(null), [fen, hidden, disabled]);
  return (
    <Box ref={ref} h="100%" w="100%" style={{ display: "grid", placeItems: "center" }}>
      {hidden ? (
        <Paper p="xl">
          <Text>{t("Book.Paused", { defaultValue: "Paused — resume to show the problem." })}</Text>
        </Paper>
      ) : (
        <Box
          className={classes.chessboard}
          style={{
            flex: "none",
            width: Math.max(0, Math.min(width || 500, height || 500)),
            position: "relative",
            aspectRatio: "1",
          }}
        >
          <PromotionModal
            pendingMove={pending}
            cancelMove={() => setPending(null)}
            turn={pos?.turn ?? "white"}
            orientation={orientation}
            confirmMove={(promotion) => {
              if (pending) onMove(makeUci({ ...pending, promotion }));
              setPending(null);
            }}
          />
          <Chessground
            fen={fen}
            orientation={orientation}
            coordinates
            check={pos?.isCheck()}
            turnColor={pos?.turn}
            animation={{ enabled: false }}
            drawable={{
              enabled: !disabled,
              visible: true,
              autoShapes: hint
                ? [
                    {
                      orig: hint.slice(0, 2) as never,
                      dest: hint.slice(2, 4) as never,
                      brush: "green",
                    },
                  ]
                : [],
            }}
            movable={{
              free: false,
              color: disabled ? undefined : pos?.turn,
              dests: pos ? chessgroundDests(pos) : new Map(),
              events: {
                after: (orig, dest) => {
                  const move = { from: parseSquare(orig)!, to: parseSquare(dest)! };
                  if (
                    pos?.board.get(move.from)?.role === "pawn" &&
                    (dest[1] === "1" || dest[1] === "8")
                  )
                    setPending(move);
                  else onMove(makeUci(move));
                },
              },
            }}
          />
        </Box>
      )}
    </Box>
  );
}
