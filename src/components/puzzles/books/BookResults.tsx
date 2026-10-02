import { Accordion, Badge, Button, Group, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { mainLine, statistics, type Session } from "./model";

export default function BookResults({
  session,
  onPosition,
}: {
  session: Session;
  onPosition: (fen: string, orientation: "white" | "black") => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState("correct");
  const stats = statistics(session, scope === "correct");
  const time = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)} s`);
  return (
    <Stack gap="sm">
      <Text fw={700}>
        {session.book.title} · {session.mode} · {new Date(session.createdAt).toLocaleString()}
      </Text>
      <Group>
        <Badge>{session.status}</Badge>
        <Text size="sm">
          {t("Book.Interruptions", { defaultValue: "Interruptions" })}: {session.interruptions}
        </Text>
      </Group>
      <Text>
        {t("Book.FirstTry", { defaultValue: "Complete first-try" })}: {stats.correct} /{" "}
        {session.attempts.length}
      </Text>
      <Text>
        {t("Book.Incorrect", { defaultValue: "Incorrect" })}: {stats.incorrect} /{" "}
        {session.attempts.length}
      </Text>
      <Text>
        {t("Book.Unanswered", { defaultValue: "Unanswered" })}: {stats.unanswered}
      </Text>
      <Select
        label={t("Book.TimeStatistics", { defaultValue: "Time statistics" })}
        value={scope}
        onChange={(v) => setScope(v ?? "correct")}
        data={[
          {
            value: "correct",
            label: t("Book.CorrectTimes", { defaultValue: "Complete first-try only" }),
          },
          {
            value: "all",
            label: t("Book.AllTimes", { defaultValue: "All presented and finalized problems" }),
          },
        ]}
      />
      <Group>
        <Text>Median: {time(stats.median)}</Text>
        <Text>P90: {time(stats.p90)}</Text>
        <Text>n = {stats.count}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {t("Book.TimingNote", {
          defaultValue:
            "Paused time is excluded. Unpresented timeouts are excluded from time statistics.",
        })}
      </Text>
      <Accordion>
        {session.attempts.map((attempt, i) => (
          <Accordion.Item key={attempt.id} value={attempt.id}>
            <Accordion.Control>
              {i + 1}. {attempt.problem.number} · {attempt.result ?? "unanswered"} ·{" "}
              {time(attempt.elapsedMs / 1000)}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text>
                  {session.book.title} · {session.book.edition} · {attempt.problem.chapter}
                </Text>
                <Text size="sm">
                  {t("Book.Pages", { defaultValue: "Problem / answer pages" })}:{" "}
                  {attempt.problem.page} / {attempt.problem.answerPage}
                </Text>
                <Text>{attempt.problem.prompt}</Text>
                <Text>{attempt.problem.themes.join(" · ")}</Text>
                <Text size="sm">
                  {t("Book.Errors", { defaultValue: "Errors" })}: {attempt.errors} · Hint:{" "}
                  {String(attempt.hinted)} · Reveal: {String(attempt.revealed)}
                </Text>
                <Text size="sm">
                  {attempt.actions.map((a) => `${a.uci}${a.correct ? " ✓" : " ✗"}`).join(" · ")}
                </Text>
                <Text style={{ whiteSpace: "pre-wrap" }}>{attempt.problem.explanation}</Text>
                <Group>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() =>
                      onPosition(
                        attempt.problem.fen,
                        attempt.problem.fen.split(" ")[1] === "b" ? "black" : "white",
                      )
                    }
                  >
                    {t("Book.StartPosition", { defaultValue: "Start position" })}
                  </Button>
                  {mainLine(attempt.problem).map((step, ply) => (
                    <Button
                      key={ply}
                      size="xs"
                      variant="subtle"
                      title={step.comment}
                      onClick={() =>
                        onPosition(
                          step.fen,
                          attempt.problem.fen.split(" ")[1] === "b" ? "black" : "white",
                        )
                      }
                    >
                      {ply + 1}. {step.san}
                    </Button>
                  ))}
                </Group>
                {mainLine(attempt.problem)
                  .filter((step) => step.comment)
                  .map((step, ply) => (
                    <Text size="sm" key={ply}>
                      {step.san}: {step.comment}
                    </Text>
                  ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
