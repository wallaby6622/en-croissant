import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Portal,
  RangeSlider,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useSessionStorage } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconFlame,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
  IconZoomCheck,
} from "@tabler/icons-react";
import { isNormal, makeSquare, parseUci } from "chessops";
import { useAtom, useSetAtom } from "jotai";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { commands, type PuzzleDatabaseInfo } from "@/bindings";
import {
  activeTabAtom,
  currentPuzzleFamily,
  puzzleTimerFamily,
  hidePuzzleRatingAtom,
  jumpToNextPuzzleAtom,
  progressivePuzzlesAtom,
  puzzleRatingRangeAtom,
  puzzleThemeAtom,
  selectedPuzzleDbAtom,
  tabsAtom,
  trackPuzzleTimeAtom,
} from "@/state/atoms";
import { positionFromFen } from "@/utils/chessops";
import { formatThemeLabel, formatTime } from "@/utils/format";
import { type Completion, getPuzzleDatabases, type Puzzle } from "@/utils/puzzles";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";
import ChallengeHistory from "../common/ChallengeHistory";
import ConfirmModal from "../common/ConfirmModal";
import GameNotation from "../common/GameNotation";
import MoveControls from "../common/MoveControls";
import { TreeStateContext } from "../common/TreeStateContext";
import AddPuzzle from "./AddPuzzle";
import PuzzleBoard from "./PuzzleBoard";
import { progressiveRange, puzzleMoveIndex, validPuzzle } from "./puzzleTraining";

function Puzzles({ id }: { id: string }) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const setFen = useStore(store, (s) => s.setFen);
  const reset = useStore(store, (s) => s.reset);
  const makeMove = useStore(store, (s) => s.makeMove);
  const setShapes = useStore(store, (s) => s.setShapes);
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const [puzzles, setPuzzles] = useSessionStorage<Puzzle[]>({
    key: `${id}-puzzles`,
    defaultValue: [],
  });
  const [currentPuzzle, setCurrentPuzzle] = useAtom(currentPuzzleFamily(id));

  const [puzzleDbs, setPuzzleDbs] = useState<PuzzleDatabaseInfo[]>([]);
  const [selectedDb, setSelectedDb] = useAtom(selectedPuzzleDbAtom);

  const [settingsOpened, setSettingsOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletionRef = useRef(false);
  const [themesLoading, setThemesLoading] = useState(false);
  const requestRef = useRef<object | null>(null);
  const mountedRef = useRef(true);
  const solutionAbortRef = useRef<AbortController | null>(null);

  function cancelPending() {
    requestRef.current = null;
    setIsLoading(false);
    solutionAbortRef.current?.abort();
    setIsPlayingSolution(false);
  }

  function clearSession() {
    cancelPending();
    setPuzzles([]);
    setCurrentPuzzle(0);
    reset();
    setTimerStart(null);
    setError(null);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current = null;
      solutionAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPuzzleDatabases()
      .then((databases) => {
        if (!cancelled) setPuzzleDbs(databases);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [ratingRange, setRatingRange] = useAtom(puzzleRatingRangeAtom);

  const [minRating, maxRating] = ratingRange;

  const [selectedTheme, setSelectedTheme] = useAtom(puzzleThemeAtom);
  const [availableThemes, setAvailableThemes] = useState<string[]>([]);
  const [themesTableMissing, setThemesTableMissing] = useState(false);
  const effectiveSelectedTheme =
    selectedTheme && availableThemes.includes(selectedTheme) ? selectedTheme : null;

  useEffect(() => {
    let cancelled = false;
    setThemesTableMissing(false);
    setAvailableThemes([]);
    setThemesLoading(!!selectedDb);
    if (selectedDb) {
      void commands
        .getPuzzleThemes(selectedDb)
        .then((res) => {
          if (cancelled) return;
          if (res.status === "ok") setAvailableThemes(res.data);
          else if (res.error.includes("no such table")) setThemesTableMissing(true);
          else setError(res.error);
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        })
        .finally(() => {
          if (!cancelled) setThemesLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedDb]);

  useEffect(() => {
    requestRef.current = null;
    setIsLoading(false);
    solutionAbortRef.current?.abort();
    setIsPlayingSolution(false);
    setError(null);
  }, [selectedDb, minRating, maxRating, selectedTheme]);

  const [jumpToNextPuzzleImmediately, setJumpToNextPuzzleImmediately] =
    useAtom(jumpToNextPuzzleAtom);

  const wonPuzzles = puzzles.filter((p) => p.completion === "correct");
  const lostPuzzles = puzzles.filter((p) => p.completion === "incorrect");

  const totalCompleted = wonPuzzles.length + lostPuzzles.length;
  const accuracy =
    totalCompleted > 0 ? Math.round((wonPuzzles.length / totalCompleted) * 100) : null;

  let currentStreak = 0;
  for (let i = puzzles.length - 1; i >= 0; i--) {
    if (puzzles[i].completion === "correct") currentStreak++;
    else if (puzzles[i].completion === "incorrect") break;
  }

  const avgTimeSeconds =
    wonPuzzles.length > 0
      ? wonPuzzles.reduce((acc, p) => acc + (p.timeSpent || 0), 0) / wonPuzzles.length / 1000
      : 0;

  function setPuzzle(puzzle: { fen: string; moves: string[] }) {
    setFen(puzzle.fen);
    makeMove({ payload: parseUci(puzzle.moves[0])!, changeHeaders: false });
  }

  async function generatePuzzle(db: string, force: boolean = false) {
    if (requestRef.current || themesLoading) return;
    cancelPending();
    setError(null);
    const selectionKey = JSON.stringify([db, ratingRange, effectiveSelectedTheme]);
    const matches = (p: Puzzle, i: number) =>
      i !== currentPuzzle && p.completion === "incomplete" && p.selectionKey === selectionKey;
    let nextIndex = puzzles.findIndex((p, i) => i > currentPuzzle && matches(p, i));
    if (nextIndex === -1) nextIndex = puzzles.findIndex(matches);
    if (nextIndex !== -1 && !force) {
      selectPuzzle(nextIndex);
      return;
    }

    const request = {};
    requestRef.current = request;
    setIsLoading(true);
    const current = puzzles[currentPuzzle];
    const range = progressive && current ? progressiveRange(current.rating) : ratingRange;
    try {
      const res = await commands.getPuzzle(db, range[0], range[1], effectiveSelectedTheme);
      if (!mountedRef.current || requestRef.current !== request) return;
      if (res.status === "error") {
        setError(res.error);
        return;
      }
      const moves = res.data.moves.trim().split(/\s+/);
      if (!validPuzzle(res.data.fen, moves)) {
        setError(
          t("Puzzle.InvalidData", {
            defaultValue: "This puzzle has an invalid position or solution. Try another puzzle.",
          }),
        );
        return;
      }
      const newPuzzle: Puzzle = {
        ...res.data,
        moves,
        completion: "incomplete",
        sourceDb: db,
        attemptId: crypto.randomUUID(),
        selectionKey: JSON.stringify([db, range, effectiveSelectedTheme]),
      };
      setPuzzles((previous) => [...previous, newPuzzle]);
      setCurrentPuzzle(puzzles.length);
      setPuzzle(newPuzzle);
      setTimerStart(trackTime ? Date.now() : null);
      if (progressive) setRatingRange(range);
    } catch (reason) {
      if (mountedRef.current && requestRef.current === request) setError(String(reason));
    } finally {
      if (mountedRef.current && requestRef.current === request) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  }

  function changeCompletion(completion: Completion) {
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle || puzzle.completion !== "incomplete") return;
    const timeSpent =
      trackTime && timerStart !== null ? Date.now() - timerStart : puzzle.timeSpent || 0;
    setPuzzles((previous) =>
      previous.map((entry, index) =>
        index === currentPuzzle && entry.completion === "incomplete"
          ? { ...entry, completion, timeSpent }
          : entry,
      ),
    );
    setTimerStart(null);
    if (puzzle.sourceDb && puzzle.attemptId) {
      void commands
        .getThemesForPuzzle(puzzle.sourceDb, puzzle.id)
        .then((res) => {
          if (!mountedRef.current || res.status !== "ok") return;
          setPuzzles((previous) =>
            previous.map((entry) =>
              entry.attemptId === puzzle.attemptId ? { ...entry, themes: res.data } : entry,
            ),
          );
        })
        .catch(() => {
          /* Older databases may not provide themes. */
        });
    }
  }

  function selectPuzzle(index: number) {
    const puzzle = puzzles[index];
    if (!puzzle) return;
    cancelPending();
    setCurrentPuzzle(index);
    setPuzzle(puzzle);
    setTimerStart(
      trackTime && puzzle.completion === "incomplete" ? Date.now() - (puzzle.timeSpent || 0) : null,
    );
  }

  const [addOpened, setAddOpened] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [isPlayingSolution, setIsPlayingSolution] = useState(false);

  const [progressive, setProgressive] = useAtom(progressivePuzzlesAtom);
  const [hideRating, setHideRating] = useAtom(hidePuzzleRatingAtom);
  const [trackTime, setTrackTime] = useAtom(trackPuzzleTimeAtom);

  const [timerStart, setTimerStart] = useAtom(puzzleTimerFamily(id));
  const [, setTick] = useState(0);
  const activePuzzle = puzzles[currentPuzzle];
  const attemptId = activePuzzle?.attemptId;
  const isPuzzleIncomplete = activePuzzle?.completion === "incomplete";
  const elapsedTime =
    timerStart !== null && isPuzzleIncomplete && trackTime
      ? Date.now() - timerStart
      : puzzles[currentPuzzle]?.timeSpent || 0;

  useEffect(() => {
    if (trackTime && isPuzzleIncomplete && timerStart === null) {
      setTimerStart(Date.now() - (activePuzzle?.timeSpent || 0));
    }
  }, [trackTime, isPuzzleIncomplete, timerStart, setTimerStart, activePuzzle?.timeSpent]);

  useEffect(() => () => setTimerStart(null), [setTimerStart]);

  useEffect(() => {
    if (!trackTime || !isPuzzleIncomplete || timerStart === null) return;

    const displayInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 100);

    return () => clearInterval(displayInterval);
  }, [trackTime, isPuzzleIncomplete, timerStart]);

  useEffect(() => {
    return () => {
      if (trackTime && timerStart !== null && isPuzzleIncomplete) {
        const finalElapsed = Date.now() - timerStart;
        setPuzzles((prev) =>
          prev.map((puzzle, index) =>
            index === currentPuzzle &&
            puzzle.attemptId === attemptId &&
            puzzle.completion === "incomplete"
              ? { ...puzzle, timeSpent: finalElapsed }
              : puzzle,
          ),
        );
      }
    };
  }, [trackTime, timerStart, currentPuzzle, attemptId, isPuzzleIncomplete, setPuzzles]);

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const turnToMove =
    puzzles[currentPuzzle] !== undefined
      ? positionFromFen(puzzles[currentPuzzle]?.fen)[0]?.turn
      : null;

  const nextIndex = activePuzzle ? puzzleMoveIndex(root, position, activePuzzle.moves) : null;
  const hintMove =
    nextIndex !== null && nextIndex > 0 && nextIndex < (activePuzzle?.moves.length || 0)
      ? parseUci(activePuzzle!.moves[nextIndex])
      : undefined;

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <PuzzleBoard
          key={activePuzzle?.attemptId ?? currentPuzzle}
          puzzles={puzzles}
          currentPuzzle={currentPuzzle}
          changeCompletion={changeCompletion}
          generatePuzzle={generatePuzzle}
          db={selectedDb}
          disabled={isLoading || isDeleting || isPlayingSolution || themesLoading}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper
          h="100%"
          withBorder
          p="md"
          style={{
            overflow: "hidden",
          }}
        >
          <AddPuzzle
            puzzleDbs={puzzleDbs}
            opened={addOpened}
            setOpened={setAddOpened}
            setPuzzleDbs={setPuzzleDbs}
          />
          <ConfirmModal
            title="Delete Puzzle Database"
            description="Are you sure you want to delete this puzzle database?"
            opened={deleteModalOpened}
            onClose={() => setDeleteModalOpened(false)}
            onConfirm={async () => {
              if (!selectedDb || deletionRef.current) return;
              const db = selectedDb;
              deletionRef.current = true;
              setIsDeleting(true);
              setDeleteModalOpened(false);
              cancelPending();
              try {
                const result = await commands.deletePuzzleDatabase(db);
                if (!mountedRef.current) return;
                if (result.status === "error") {
                  setError(result.error);
                  return;
                }
                setPuzzleDbs((dbs) => dbs.filter((entry) => entry.path !== db));
                setSelectedDb((current) => (current === db ? null : current));
                clearSession();
                setDeleteModalOpened(false);
              } catch (reason) {
                if (mountedRef.current) setError(String(reason));
              } finally {
                deletionRef.current = false;
                if (mountedRef.current) setIsDeleting(false);
              }
            }}
          />
          {error && (
            <Alert
              color="red"
              title={t("Common.Error")}
              withCloseButton
              onClose={() => setError(null)}
              mb="sm"
            >
              {error}
            </Alert>
          )}
          <Group justify="space-between" pb="sm">
            <Select
              style={{ flex: 1 }}
              data={puzzleDbs
                .map((p) => ({
                  label: p.title.split(".db3")[0],
                  value: p.path,
                }))
                .concat({ label: `+ ${t("Common.AddNew")}`, value: "add" })}
              value={selectedDb}
              disabled={isDeleting}
              clearable={false}
              placeholder={t("Puzzle.SelectDatabase")}
              onChange={(v) => {
                if (v === "add") {
                  setAddOpened(true);
                } else {
                  setSelectedDb(v);
                }
              }}
            />
            <Group gap="xs">
              <Tooltip label="Delete database">
                <ActionIcon
                  color="red"
                  aria-label="Delete database"
                  disabled={!selectedDb || isDeleting}
                  onClick={() => setDeleteModalOpened(true)}
                >
                  <IconTrash size={20} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("SideBar.Settings")}>
                <ActionIcon onClick={() => setSettingsOpened((o) => !o)}>
                  <IconSettings size={20} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Accordion
            value={settingsOpened ? "settings" : null}
            onChange={(v) => setSettingsOpened(v === "settings")}
            mb="sm"
          >
            <Accordion.Item value="settings">
              <Accordion.Panel>
                <Stack gap="md">
                  {themesTableMissing && (
                    <Alert
                      icon={<IconAlertTriangle />}
                      title="Puzzle database outdated"
                      color="yellow"
                    >
                      This database does not support themes. Update to the latest puzzle DB.
                    </Alert>
                  )}
                  <div>
                    <Text size="sm" fw={500} mb={4}>
                      {t("Puzzle.RatingRange")}
                    </Text>
                    <RangeSlider
                      min={600}
                      my="md"
                      max={2800}
                      value={ratingRange}
                      onChange={setRatingRange}
                      disabled={progressive}
                      marks={[
                        { value: 600, label: "600" },
                        { value: 1700, label: "1700" },
                        { value: 2800, label: "2800" },
                      ]}
                    />
                  </div>
                  <Select
                    label="Theme"
                    placeholder="All themes"
                    data={availableThemes.map((theme) => ({
                      label: formatThemeLabel(theme),
                      value: theme,
                    }))}
                    value={effectiveSelectedTheme}
                    onChange={setSelectedTheme}
                    clearable
                    searchable
                  />
                  <SimpleGrid cols={2} spacing="sm">
                    <Switch
                      label={t("Puzzle.Progressive")}
                      description={t("Puzzle.Progressive.Desc")}
                      checked={progressive}
                      onChange={(event) => setProgressive(event.currentTarget.checked)}
                    />
                    <Switch
                      label={t("Puzzle.HideRating")}
                      description={t("Puzzle.HideRating.Desc")}
                      checked={hideRating}
                      onChange={(event) => setHideRating(event.currentTarget.checked)}
                    />
                    <Switch
                      label={t("Puzzle.JumpToNextPuzzleImmediately")}
                      description={t("Puzzle.JumpToNextPuzzleImmediately.Desc")}
                      checked={jumpToNextPuzzleImmediately}
                      onChange={(event) =>
                        setJumpToNextPuzzleImmediately(event.currentTarget.checked)
                      }
                    />
                    <Switch
                      label={t("Puzzle.TrackPuzzleTime")}
                      description={t("Puzzle.TrackPuzzleTime.Desc")}
                      checked={trackTime}
                      onChange={(event) => {
                        if (!event.currentTarget.checked) {
                          setTimerStart(null);
                          setTrackTime(false);
                        } else {
                          setTrackTime(true);
                        }
                      }}
                    />
                  </SimpleGrid>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
          <Group grow>
            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                {t("Puzzle.Rating")}
              </Text>
              <Text fw={700} size="lg">
                {isPuzzleIncomplete && hideRating && puzzles[currentPuzzle]?.rating
                  ? "?"
                  : puzzles[currentPuzzle]?.rating || "-"}
              </Text>
            </Paper>

            {trackTime && (
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  {t("Puzzle.Time")}
                </Text>
                <Text fw={700} size="lg" ff="monospace">
                  {formatTime(elapsedTime)}
                </Text>
              </Paper>
            )}

            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                {t("Puzzle.Accuracy")}
              </Text>
              <Text
                fw={700}
                size="lg"
                c={accuracy === null ? "dimmed" : accuracy >= 50 ? "teal" : "orange"}
              >
                {accuracy !== null ? `${accuracy}%` : "-"}
              </Text>
            </Paper>

            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                {t("Puzzle.Streak")}
              </Text>
              <Group gap={2}>
                <Text fw={700} size="lg">
                  {currentStreak}
                </Text>
                <IconFlame size={20} color="orange" />
              </Group>
            </Paper>

            {trackTime && avgTimeSeconds > 0 && (
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  {t("Puzzle.AvgTime")}
                </Text>
                <Text fw={700} size="lg">
                  {avgTimeSeconds.toFixed(1)}s
                </Text>
              </Paper>
            )}
          </Group>
          <Divider my="sm" />
          {!isPuzzleIncomplete && (puzzles[currentPuzzle]?.themes?.length ?? 0) > 0 && (
            <Group gap="xs" mb="sm">
              {puzzles[currentPuzzle]?.themes?.map((theme) => (
                <Badge key={theme} variant="light" size="sm">
                  {formatThemeLabel(theme)}
                </Badge>
              ))}
            </Group>
          )}
          <Group justify="space-between">
            <Text fz="1.75rem" fw={500}>
              {!turnToMove
                ? ""
                : turnToMove === "white"
                  ? t("Fen.BlackToMove")
                  : t("Fen.WhiteToMove")}
            </Text>
            <Group gap="xs">
              <Tooltip label={t("Puzzle.NewPuzzle")}>
                <ActionIcon
                  aria-label={t("Puzzle.NewPuzzle")}
                  disabled={!selectedDb || isLoading || isDeleting || themesLoading}
                  loading={isLoading}
                  onClick={() => {
                    if (selectedDb) void generatePuzzle(selectedDb, true);
                  }}
                >
                  <IconPlus />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Puzzle.AnalyzePosition")}>
                <ActionIcon
                  aria-label={t("Puzzle.AnalyzePosition")}
                  disabled={!activePuzzle || isPlayingSolution || isLoading}
                  onClick={() => {
                    if (!activePuzzle) return;
                    cancelPending();
                    void createTab({
                      tab: {
                        name: "Puzzle Analysis",
                        type: "analysis",
                      },
                      setTabs,
                      setActiveTab,
                      pgn: activePuzzle.moves.join(" "),
                      headers: {
                        ...defaultTree().headers,
                        fen: activePuzzle.fen,
                        orientation: turnToMove === "white" ? "black" : "white",
                      },
                    }).catch((reason) => {
                      if (mountedRef.current) setError(String(reason));
                    });
                  }}
                >
                  <IconZoomCheck />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Puzzle.ClearSession")}>
                <ActionIcon aria-label={t("Puzzle.ClearSession")} onClick={clearSession}>
                  <IconX />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Group grow>
            <Button
              mt="sm"
              variant="light"
              fullWidth
              onClick={async () => {
                if (!activePuzzle || !hintMove || !isNormal(hintMove)) return;
                const nextMove = hintMove;
                changeCompletion("incorrect");
                const from = makeSquare(nextMove.from);
                const to = makeSquare(nextMove.to);
                const currentShapes = store.getState().currentNode().shapes;

                // Progressive hints: circle > arrow > clear
                const hasCircle = currentShapes.some((s) => s.orig === from && !s.dest);
                const hasArrow = currentShapes.some((s) => s.orig === from && s.dest === to);

                // TreeStore toggles one shape at a time.
                if (hasArrow) {
                  setShapes([{ orig: from, dest: to, brush: "green" }]);
                  if (hasCircle) setShapes([{ orig: from, brush: "green" }]);
                } else if (hasCircle) {
                  setShapes([{ orig: from, brush: "green" }]);
                  setShapes([{ orig: from, dest: to, brush: "green" }]);
                } else {
                  setShapes([{ orig: from, brush: "green" }]);
                }
              }}
              disabled={!hintMove || isPlayingSolution || isLoading}
            >
              {t("Puzzle.GetAHint")}
            </Button>
            <Button
              mt="sm"
              variant="light"
              fullWidth
              onClick={async () => {
                const curPuzzle = activePuzzle;
                if (!curPuzzle || isLoading) return;
                cancelPending();
                const abortController = new AbortController();
                solutionAbortRef.current = abortController;

                changeCompletion("incorrect");
                setIsPlayingSolution(true);
                setFen(curPuzzle.fen);
                for (let i = 0; i < curPuzzle.moves.length; i++) {
                  if (abortController.signal.aborted) break;
                  makeMove({
                    payload: parseUci(curPuzzle.moves[i])!,
                    mainline: true,
                    changeHeaders: false,
                  });
                  await new Promise((r) => setTimeout(r, 500));
                }
                if (!abortController.signal.aborted && mountedRef.current)
                  setIsPlayingSolution(false);
              }}
              disabled={!activePuzzle || isLoading || isPlayingSolution}
            >
              {t("Puzzle.ViewSolution")}
            </Button>
          </Group>
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <Paper withBorder p="md" mih="5rem">
            <ScrollArea h="100%" offsetScrollbars>
              <ChallengeHistory
                challenges={puzzles.map((p) => ({
                  ...p,
                  label: p.rating?.toString() ?? "-",
                }))}
                current={currentPuzzle}
                select={(i) => {
                  if (i !== currentPuzzle) selectPuzzle(i);
                }}
              />
            </ScrollArea>
          </Paper>
          <Stack flex={1} gap="xs">
            <GameNotation />
            <MoveControls readOnly />
          </Stack>
        </Stack>
      </Portal>
    </>
  );
}

export default Puzzles;
