import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Portal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { INITIAL_FEN } from "chessops/fen";
import BookBoard from "./BookBoard";
import BookResults from "./BookResults";
import {
  abandon,
  activeSession,
  advance,
  candidates,
  currentAttempt,
  elapsed,
  importBook,
  mainLine,
  masteryDefaults,
  nextMoves,
  pause,
  resume,
  reveal,
  skip,
  startSession,
  statistics,
  submitMove,
  tick,
  useHint,
  type ExamConfig,
  type ImportReport,
  type Mode,
  type Session,
  type TrainingState,
} from "./model";
import {
  getTraining,
  loadTraining,
  pauseTraining,
  readBook,
  updateTraining,
  useTraining,
} from "./store";

export default function BookTraining({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { state, busy, error } = useTraining();
  const [bookId, setBookId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("learn");
  const [config, setConfig] = useState<ExamConfig>({ ...masteryDefaults });
  const [report, setReport] = useState<ImportReport | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fen: string; orientation: "white" | "black" } | null>(
    null,
  );
  const actionLock = useRef(false);
  const active = state ? activeSession(state) : undefined;
  const attempt = active ? currentAttempt(active) : undefined;
  const selectedBook = state?.books.find((b) => b.book.id === bookId) ?? state?.books[0];
  const available = state && selectedBook ? candidates(state, selectedBook, mode, config, now) : [];
  const result =
    !active && state
      ? (state.sessions.find((s) => s.id === selectedResult) ??
        [...state.sessions]
          .reverse()
          .find((s) => s.status === "complete" || s.status === "abandoned"))
      : undefined;

  useEffect(() => {
    if (!getTraining().state) void loadTraining();
    let disposed = false;
    let allowClose = false;
    const subscription = getCurrentWindow().onCloseRequested(async (event) => {
      if (allowClose || disposed || !getTraining().state) return;
      event.preventDefault();
      await updateTraining((data) => {
        const session = activeSession(data);
        if (session) {
          tick(data, session, Date.now());
          pause(data, session, Date.now());
        }
      });
      if (!getTraining().error) {
        allowClose = true;
        void getCurrentWindow().close();
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 200);
    const checkpoint = setInterval(() => {
      const current = getTraining();
      const session = current.state && activeSession(current.state);
      if (!current.busy && !current.error && session?.status === "active")
        void updateTraining((data) => {
          const current = activeSession(data);
          if (current) tick(data, current, Date.now());
        });
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearInterval(checkpoint);
      void subscription.then((unlisten) => unlisten()).catch(() => {});
      void pauseTraining();
    };
  }, []);

  useEffect(() => {
    if (
      !active ||
      active.status !== "active" ||
      active.mode !== "exam" ||
      active.config.time === "none" ||
      busy ||
      error
    )
      return;
    const deadline =
      active.config.time === "total"
        ? active.createdAt + active.config.seconds * 1000
        : (currentAttempt(active).startedAt ?? now) + active.config.seconds * 1000;
    if (now >= deadline && (active.config.time === "total" || !currentAttempt(active).result))
      void updateTraining((data) => {
        const session = activeSession(data);
        if (session) tick(data, session, now);
      });
  }, [active, now, busy, error]);

  async function act(action: (data: TrainingState, session: Session, at: number) => void) {
    if (!active || actionLock.current || busy || error) return;
    actionLock.current = true;
    const id = active.id;
    const attemptId = attempt?.id;
    const at = Date.now();
    try {
      await updateTraining((data) => {
        const session = activeSession(data);
        if (!session || session.id !== id || currentAttempt(session).id !== attemptId) return;
        action(data, session, at);
      });
      setPreview(null);
    } finally {
      actionLock.current = false;
    }
  }
  async function chooseFile() {
    setLocalError(null);
    setImporting(true);
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "Book puzzle database", extensions: ["db3"] }],
      });
      if (typeof file === "string") setReport(await readBook(file));
    } catch (reason) {
      setLocalError(String(reason));
    } finally {
      setImporting(false);
    }
  }
  const changeConfig = (patch: Partial<ExamConfig>) =>
    setConfig((previous) => ({ ...previous, ...patch }));
  const locked = busy || !!error;
  const speed = active?.mode === "exam" && active.config.time !== "none";
  const canShowSolution =
    attempt && (active?.mode !== "exam" ? !!attempt.result : attempt.revealed);
  const orientation = (attempt?.problem.fen.split(" ")[1] === "b" ? "black" : "white") as
    | "white"
    | "black";
  const fen = preview?.fen ?? attempt?.fen ?? INITIAL_FEN;
  const solution = attempt ? mainLine(attempt.problem) : [];
  const left = (
    <BookBoard
      key={`${attempt?.id ?? "preview"}-${attempt?.actions.length ?? 0}-${preview?.fen ?? ""}`}
      fen={fen}
      orientation={preview?.orientation ?? orientation}
      hidden={active?.status === "paused"}
      disabled={!active || active.status !== "active" || !!attempt?.result || locked || !!preview}
      hint={
        attempt?.hinted && !attempt.result && !attempt.problem.hints.length
          ? nextMoves(attempt)[0]?.uci
          : undefined
      }
      onMove={(uci) => {
        void act((data, session, at) => submitMove(data, session, uci, at));
      }}
    />
  );

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <div style={{ height: "100%" }}>{left}</div>
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <ScrollArea h="100%">
          <Stack p="md" gap="sm">
            <Group justify="space-between">
              <Text fw={700}>{t("Book.Title", { defaultValue: "Book puzzle training" })}</Text>
              <Button
                size="xs"
                variant="subtle"
                disabled={busy}
                onClick={async () => {
                  await pauseTraining();
                  if (!getTraining().error) onBack();
                }}
              >
                {t("Book.Legacy", { defaultValue: "Puzzle databases" })}
              </Button>
            </Group>
            {(error || localError) && (
              <Alert color="red" title={t("Common.Error")}>
                {error || localError}
                {error && (
                  <Button
                    mt="xs"
                    size="xs"
                    onClick={() => {
                      void loadTraining();
                    }}
                  >
                    {t("Book.Reload", { defaultValue: "Reload saved progress" })}
                  </Button>
                )}
              </Alert>
            )}
            {!state && <Text>{t("Common.Loading", { defaultValue: "Loading…" })}</Text>}
            {active && attempt ? (
              <>
                <Text>
                  {active.book.title} · {active.mode}
                </Text>
                <Group>
                  <Badge>
                    {active.index + 1} / {active.attempts.length}
                  </Badge>
                  <Text>{(elapsed(attempt, now) / 1000).toFixed(1)} s</Text>
                  {speed && (
                    <Text>
                      {t("Book.Remaining", { defaultValue: "Remaining" })}:{" "}
                      {Math.max(
                        0,
                        Math.ceil(
                          ((active.config.time === "total"
                            ? active.createdAt
                            : (attempt.startedAt ?? now)) +
                            active.config.seconds * 1000 -
                            now) /
                            1000,
                        ),
                      )}{" "}
                      s
                    </Text>
                  )}
                </Group>
                {active.status === "paused" ? (
                  <>
                    <Text>
                      {t("Book.Paused", { defaultValue: "Paused — resume to show the problem." })}
                    </Text>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        void act((_data, session, at) => resume(session, at));
                      }}
                    >
                      {t("Book.Resume", { defaultValue: "Resume" })}
                    </Button>
                  </>
                ) : (
                  <>
                    {active.mode !== "exam" && (
                      <Text size="sm">
                        {active.book.edition} · {attempt.problem.chapter} · {attempt.problem.number}{" "}
                        · p. {attempt.problem.page}
                      </Text>
                    )}
                    <Text style={{ whiteSpace: "pre-wrap" }}>
                      {active.mode === "exam"
                        ? (attempt.problem.examPrompt ?? attempt.problem.prompt)
                        : attempt.problem.prompt}
                    </Text>
                    <Text>
                      {orientation === "white" ? t("Fen.WhiteToMove") : t("Fen.BlackToMove")}
                    </Text>
                    {active.mode !== "exam" && attempt.errors > 0 && !attempt.result && (
                      <Alert color="orange">
                        {t("Book.TryAgain", {
                          defaultValue:
                            "That move is not in the book solution. Try again; this attempt will be graded Again.",
                        })}
                      </Alert>
                    )}
                    {attempt.hinted && (
                      <Text style={{ whiteSpace: "pre-wrap" }}>
                        {attempt.problem.hints.join("\n") ||
                          (attempt.result === "hint" ? nextMoves(attempt)[0]?.uci : "")}
                      </Text>
                    )}
                    {!attempt.result && (
                      <Group>
                        <Button
                          variant="light"
                          disabled={locked || (active.mode === "exam" && !active.config.hints)}
                          onClick={() => {
                            void act(useHint);
                          }}
                        >
                          {t("Puzzle.GetAHint")}
                        </Button>
                        <Button
                          variant="light"
                          disabled={locked || (active.mode === "exam" && !active.config.reveal)}
                          onClick={() => {
                            void act(reveal);
                          }}
                        >
                          {t("Puzzle.ViewSolution")}
                        </Button>
                        {active.mode === "exam" && (
                          <Button
                            variant="subtle"
                            disabled={locked}
                            onClick={() => {
                              void act(skip);
                            }}
                          >
                            {t("Book.Skip", { defaultValue: "Skip (incorrect)" })}
                          </Button>
                        )}
                      </Group>
                    )}
                    {attempt.result && (
                      <>
                        <Text fw={700}>
                          {active.mode === "exam"
                            ? t("Book.Incorrect", { defaultValue: "Incorrect" })
                            : attempt.result === "correct"
                              ? "Good"
                              : "Again"}
                        </Text>
                        {canShowSolution && (
                          <>
                            <Text style={{ whiteSpace: "pre-wrap" }}>
                              {attempt.problem.explanation}
                            </Text>
                            <Text>{attempt.problem.themes.join(" · ")}</Text>
                            <Text size="xs">
                              {t("Book.Pages", { defaultValue: "Problem / answer pages" })}:{" "}
                              {attempt.problem.page} / {attempt.problem.answerPage}
                            </Text>
                            <Group>
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() =>
                                  setPreview({ fen: attempt.problem.fen, orientation })
                                }
                              >
                                {t("Book.StartPosition", { defaultValue: "Start position" })}
                              </Button>
                              {solution.map((step, i) => (
                                <Button
                                  key={i}
                                  size="xs"
                                  variant="subtle"
                                  title={step.comment}
                                  onClick={() => setPreview({ fen: step.fen, orientation })}
                                >
                                  {i + 1}. {step.san}
                                </Button>
                              ))}
                            </Group>
                            {solution
                              .filter((step) => step.comment)
                              .map((step, i) => (
                                <Text key={i} size="sm">
                                  {step.san}: {step.comment}
                                </Text>
                              ))}
                          </>
                        )}
                        <Button
                          disabled={locked}
                          onClick={() => {
                            void act((data, session, at) => {
                              tick(data, session, at);
                              if (session.status === "active") advance(data, session, at);
                            });
                          }}
                        >
                          {t("Book.Continue", { defaultValue: "Continue" })}
                        </Button>
                      </>
                    )}
                  </>
                )}
                <Group>
                  {!speed && active.status === "active" && (
                    <Button
                      variant="subtle"
                      disabled={locked}
                      onClick={() => {
                        void act(pause);
                      }}
                    >
                      {t("Book.Pause", { defaultValue: "Pause" })}
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    color="red"
                    disabled={locked}
                    onClick={() => {
                      void act(abandon);
                    }}
                  >
                    {t("Book.EndSession", { defaultValue: "End session (keep as incomplete)" })}
                  </Button>
                </Group>
              </>
            ) : (
              state && (
                <>
                  <Button
                    loading={importing}
                    disabled={busy}
                    onClick={() => {
                      void chooseFile();
                    }}
                  >
                    {t("Book.Import", { defaultValue: "Import book .db3" })}
                  </Button>
                  {report && (
                    <Paper withBorder p="sm">
                      <Stack gap="xs">
                        <Text fw={600}>
                          {report.book.title} · {report.book.edition}
                        </Text>
                        <Text>
                          {t("Book.ImportCount", {
                            defaultValue: "Valid: {{valid}} · Excluded: {{excluded}}",
                            valid: report.problems.length,
                            excluded: report.rejected.length,
                          })}
                        </Text>
                        {report.rejected.map((item) => (
                          <Text key={item.id} size="xs" c="red">
                            {item.id}: {item.reason}
                          </Text>
                        ))}
                        <Text size="xs">
                          {t("Book.UpdateNote", {
                            defaultValue:
                              "Importing an existing book updates its content. Changed positions or solutions reset those cards; past results are preserved.",
                          })}
                        </Text>
                        <Group>
                          <Button
                            disabled={locked || !report.problems.length}
                            onClick={async () => {
                              await updateTraining((data) => importBook(data, report));
                              if (!getTraining().error) {
                                setBookId(report.book.id);
                                setReport(null);
                              }
                            }}
                          >
                            {t("Book.ConfirmImport", { defaultValue: "Import valid problems" })}
                          </Button>
                          <Button variant="subtle" onClick={() => setReport(null)}>
                            {t("Common.Cancel")}
                          </Button>
                        </Group>
                      </Stack>
                    </Paper>
                  )}
                  <Select
                    label="Source"
                    data={state.books.map((b) => ({
                      value: b.book.id,
                      label: `${b.book.title} · ${b.book.edition}`,
                    }))}
                    value={selectedBook?.book.id ?? null}
                    onChange={(value) => {
                      setBookId(value);
                      changeConfig({ chapter: "" });
                    }}
                  />
                  <SegmentedControl
                    fullWidth
                    value={mode}
                    onChange={(value) => setMode(value as Mode)}
                    data={[
                      { value: "learn", label: "Learn" },
                      { value: "review", label: "Review" },
                      { value: "exam", label: "Exam" },
                    ]}
                  />
                  {mode === "exam" && (
                    <>
                      <Button variant="light" onClick={() => setConfig({ ...masteryDefaults })}>
                        Mastery Exam
                      </Button>
                      <Select
                        label="Range"
                        value={config.range}
                        onChange={(range) => changeConfig({ range: range as ExamConfig["range"] })}
                        data={[
                          { value: "all", label: "All" },
                          { value: "chapter", label: "Chapter" },
                          { value: "problems", label: "Problem range (book order)" },
                        ]}
                      />
                      {config.range === "chapter" && (
                        <Select
                          label="Chapter"
                          value={config.chapter}
                          onChange={(chapter) => changeConfig({ chapter: chapter ?? "" })}
                          data={[...new Set(selectedBook?.problems.map((p) => p.chapter) ?? [])]}
                        />
                      )}
                      {config.range === "problems" && (
                        <Group grow>
                          <NumberInput
                            label="From"
                            min={1}
                            value={config.from}
                            onChange={(from) => changeConfig({ from: Number(from) })}
                          />
                          <NumberInput
                            label="To"
                            min={config.from}
                            value={config.to}
                            onChange={(to) => changeConfig({ to: Number(to) })}
                          />
                        </Group>
                      )}
                      <NumberInput
                        label="Problems"
                        min={1}
                        allowDecimal={false}
                        value={config.count}
                        onChange={(count) => changeConfig({ count: Number(count) })}
                      />
                      <Text size="sm">
                        {t("Book.Random", { defaultValue: "Random selection without replacement" })}
                      </Text>
                      <Select
                        label="Time limit"
                        value={config.time}
                        onChange={(time) => changeConfig({ time: time as ExamConfig["time"] })}
                        data={[
                          { value: "none", label: "None" },
                          { value: "total", label: "Total time" },
                          { value: "problem", label: "Per problem" },
                        ]}
                      />
                      {config.time !== "none" && (
                        <>
                          <NumberInput
                            label={t("Book.Seconds", { defaultValue: "Seconds" })}
                            min={1}
                            value={config.seconds}
                            onChange={(seconds) => changeConfig({ seconds: Number(seconds) })}
                          />
                          <Alert color="yellow">
                            {t("Book.SpeedWarning", {
                              defaultValue:
                                "Timed exams cannot be paused. Closing the app does not stop the time limit.",
                            })}
                          </Alert>
                        </>
                      )}
                      <Switch
                        label="Reveal"
                        checked={config.reveal}
                        onChange={(e) => changeConfig({ reveal: e.currentTarget.checked })}
                      />
                      <Switch
                        label="Hints"
                        checked={config.hints}
                        onChange={(e) => changeConfig({ hints: e.currentTarget.checked })}
                      />
                      <Text size="xs">
                        {t("Book.ExamNote", {
                          defaultValue:
                            "Hints and Reveal count as incorrect. Exams never update SRS. Problem numbers, chapters and themes stay hidden until the exam ends.",
                        })}
                      </Text>
                    </>
                  )}
                  <Text>
                    {t("Book.Available", {
                      defaultValue: "Available: {{count}}",
                      count: available.length,
                    })}
                  </Text>
                  {mode === "exam" && config.count > available.length && (
                    <Alert color="yellow">
                      {t("Book.TooFew", {
                        defaultValue: "Reduce the problem count to fit the selected range.",
                      })}
                      <Button
                        size="xs"
                        disabled={!available.length}
                        onClick={() => changeConfig({ count: available.length })}
                      >
                        {t("Book.UseAvailable", { defaultValue: "Use all available problems" })}
                      </Button>
                    </Alert>
                  )}
                  <Button
                    disabled={
                      locked ||
                      !available.length ||
                      (mode === "exam" && config.count > available.length)
                    }
                    onClick={async () => {
                      if (selectedBook) {
                        await updateTraining((data) =>
                          startSession(data, selectedBook.book.id, mode, config, Date.now()),
                        );
                        setPreview(null);
                        setSelectedResult(null);
                      }
                    }}
                  >
                    {t("Book.Start", { defaultValue: "Start" })}
                  </Button>
                  <Accordion>
                    <Accordion.Item value="settings">
                      <Accordion.Control>
                        {t("Book.SrsSettings", { defaultValue: "Learning settings" })}
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack>
                          <NumberInput
                            label={t("Book.Retention", { defaultValue: "Target retention (%)" })}
                            min={70}
                            max={99}
                            value={state.settings.retention * 100}
                            onChange={(value) => {
                              const n = Number(value);
                              if (n >= 70 && n <= 99)
                                void updateTraining((data) => {
                                  data.settings.retention = n / 100;
                                });
                            }}
                          />
                          <NumberInput
                            label={t("Book.NewPerDay", { defaultValue: "New problems per day" })}
                            min={1}
                            max={1000}
                            allowDecimal={false}
                            value={state.settings.newPerDay}
                            onChange={(value) => {
                              const n = Number(value);
                              if (n >= 1 && n <= 1000)
                                void updateTraining((data) => {
                                  data.settings.newPerDay = n;
                                });
                            }}
                          />
                          <TextInput
                            label={t("Book.Timezone", {
                              defaultValue: "Study timezone (day starts at 04:00)",
                            })}
                            defaultValue={state.settings.timezone}
                            onBlur={(event) => {
                              const timezone = event.currentTarget.value;
                              try {
                                new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
                                void updateTraining((data) => {
                                  data.settings.timezone = timezone;
                                });
                                setLocalError(null);
                              } catch {
                                setLocalError("Invalid timezone");
                              }
                            }}
                          />
                          <NumberInput
                            label={t("Book.TargetAccuracy", {
                              defaultValue: "Optional exam target (%); blank means no pass/fail",
                            })}
                            min={1}
                            max={100}
                            value={state.settings.targetAccuracy ?? ""}
                            onChange={(value) => {
                              if (value === "" || (Number(value) >= 1 && Number(value) <= 100))
                                void updateTraining((data) => {
                                  data.settings.targetAccuracy =
                                    value === "" ? null : Number(value);
                                });
                            }}
                          />
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </>
              )
            )}
          </Stack>
        </ScrollArea>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <ScrollArea h="100%">
          <Stack p="md">
            {!active && state && (
              <>
                <Select
                  label={t("Book.History", { defaultValue: "Session history" })}
                  value={result?.id ?? null}
                  onChange={(value) => {
                    setSelectedResult(value);
                    setPreview(null);
                  }}
                  data={[...state.sessions]
                    .reverse()
                    .filter((s) => s.status === "complete" || s.status === "abandoned")
                    .map((s) => ({
                      value: s.id,
                      label: `${s.book.title} · ${s.mode} · ${new Date(s.createdAt).toLocaleString()}`,
                    }))}
                />
                {result && (
                  <>
                    {result.mode === "exam" &&
                      result.status === "complete" &&
                      state.settings.targetAccuracy !== null && (
                        <Text>
                          {t("Book.Target", { defaultValue: "Target" })}:{" "}
                          {state.settings.targetAccuracy}% ·{" "}
                          {(statistics(result).correct / result.attempts.length) * 100 >=
                          state.settings.targetAccuracy
                            ? "Met"
                            : "Not met"}
                        </Text>
                      )}
                    <BookResults
                      session={result}
                      onPosition={(fen, orientation) => setPreview({ fen, orientation })}
                    />
                  </>
                )}
              </>
            )}
            {active && (
              <Text size="sm" c="dimmed">
                {active.mode === "exam"
                  ? t("Book.ResultsAfter", {
                      defaultValue: "Results and solutions are available after the exam.",
                    })
                  : t("Book.Grading", {
                      defaultValue:
                        "A clean complete solution is Good. Any error or Hint makes it Again. Show solution immediately records Again. Closing an unfinished problem does not update SRS.",
                    })}
              </Text>
            )}
          </Stack>
        </ScrollArea>
      </Portal>
    </>
  );
}
