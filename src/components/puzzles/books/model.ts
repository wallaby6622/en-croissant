import { createEmptyCard, fsrs, generatorParameters, Rating, type CardInput } from "ts-fsrs";
import { makeUci, parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";

export type Mode = "learn" | "review" | "exam";
export interface Book {
    id: string;
    title: string;
    edition: string;
}
export interface SolutionMove {
    uci: string;
    comment: string;
    children: SolutionMove[];
}
export interface Problem {
    id: string;
    order: number;
    chapter: string;
    page: string;
    answerPage: string;
    number: string;
    fen: string;
    prompt: string;
    examPrompt?: string | null;
    hints: string[];
    explanation: string;
    themes: string[];
    solution: SolutionMove[];
}
export interface BookData {
    book: Book;
    problems: Problem[];
}
export interface ImportReport extends BookData {
    rejected: { id: string; reason: string }[];
}
export interface Settings {
    retention: number;
    newPerDay: number;
    timezone: string;
    targetAccuracy: number | null;
}
export interface ExamConfig {
    range: "all" | "chapter" | "problems";
    chapter: string;
    from: number;
    to: number;
    count: number;
    time: "none" | "total" | "problem";
    seconds: number;
    hints: boolean;
    reveal: boolean;
}
export const masteryDefaults: ExamConfig = {
    range: "all",
    chapter: "",
    from: 1,
    to: 100,
    count: 100,
    time: "none",
    seconds: 1800,
    hints: false,
    reveal: false,
};
export type Reason = "correct" | "wrong" | "hint" | "reveal" | "skip" | "timeout";
export interface Attempt {
    id: string;
    problem: Problem;
    fen: string;
    path: number[];
    errors: number;
    hinted: boolean;
    revealed: boolean;
    actions: { uci: string; correct: boolean; at: number }[];
    result: Reason | null;
    elapsedMs: number;
    runningSince: number | null;
    startedAt: number | null;
    finishedAt: number | null;
}
export interface Session {
    id: string;
    book: Book;
    mode: Mode;
    config: ExamConfig;
    attempts: Attempt[];
    index: number;
    status: "active" | "paused" | "complete" | "abandoned";
    interruptions: number;
    createdAt: number;
    completedAt: number | null;
}
export interface TrainingState {
    version: 1;
    settings: Settings;
    books: BookData[];
    archives: BookData[];
    cards: Record<string, { revision: string; card: CardInput }>;
    logs: {
        attemptId: string;
        key: string;
        grade: "Good" | "Again";
        at: number;
        day: string;
        first: boolean;
        log: unknown;
    }[];
    sessions: Session[];
    activeId: string | null;
}
export function emptyState(): TrainingState {
    return {
        version: 1,
        settings: {
            retention: 0.9,
            newPerDay: 20,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            targetAccuracy: null,
        },
        books: [],
        archives: [],
        cards: {},
        logs: [],
        sessions: [],
        activeId: null,
    };
}
export const problemKey = (book: string, id: string) => JSON.stringify([book, id]);
export function revision(problem: Problem): string {
    const line = (moves: SolutionMove[]): unknown =>
        moves.map((move) => [move.uci, line(move.children)]);
    return JSON.stringify([problem.fen.split(" ").slice(0, 4), line(problem.solution)]);
}
export function importBook(state: TrainingState, data: BookData) {
    if (!data.problems.length) throw new Error("No valid problems to import.");
    const active = activeSession(state);
    if (active && active.book.id === data.book.id)
        throw new Error("Finish or end the current session before updating this book.");
    const previous = state.books.find((b) => b.book.id === data.book.id);
    if (previous) state.archives.push(previous);
    for (const problem of data.problems) {
        const key = problemKey(data.book.id, problem.id);
        if (state.cards[key]?.revision !== revision(problem)) delete state.cards[key];
    }
    state.books = [...state.books.filter((b) => b.book.id !== data.book.id), data];
}
/** Shift the calendar date, not the instant, for a 04:00 cutoff even across DST changes. */
export function studyDay(now: number, timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const value = (key: string) => Number(parts.find((p) => p.type === key)?.value);
    const date = new Date(
        Date.UTC(value("year"), value("month") - 1, value("day") - (value("hour") < 4 ? 1 : 0)),
    );
    return date.toISOString().slice(0, 10);
}
export function candidates(
    state: TrainingState,
    book: BookData,
    mode: Mode,
    config: ExamConfig,
    now: number,
): Problem[] {
    const ordered = [...book.problems].sort((a, b) => a.order - b.order);
    if (mode === "exam")
        return ordered.filter(
            (p) =>
                config.range === "all" ||
                (config.range === "chapter"
                    ? p.chapter === config.chapter
                    : p.order >= config.from && p.order <= config.to),
        );
    const card = (p: Problem) => state.cards[problemKey(book.book.id, p.id)]?.card;
    if (mode === "review")
        return ordered
            .filter((p) => card(p) && new Date(card(p)!.due).getTime() <= now)
            .sort(
                (a, b) =>
                    new Date(card(a)!.due).getTime() - new Date(card(b)!.due).getTime() ||
                    a.order - b.order,
            );
    const today = studyDay(now, state.settings.timezone);
    const learned = state.logs.filter(
        (log) => log.first && studyDay(log.at, state.settings.timezone) === today,
    ).length;
    return ordered
        .filter((p) => !card(p))
        .slice(0, Math.max(0, state.settings.newPerDay - learned));
}
export function activeSession(state: TrainingState): Session | undefined {
    return state.sessions.find(
        (s) => s.id === state.activeId && (s.status === "active" || s.status === "paused"),
    );
}
export function currentAttempt(session: Session): Attempt {
    return session.attempts[session.index];
}
export function nextMoves(attempt: Attempt): SolutionMove[] {
    let nodes = attempt.problem.solution;
    for (const index of attempt.path) nodes = nodes[index]?.children ?? [];
    return nodes;
}
export function startSession(
    state: TrainingState,
    bookId: string,
    mode: Mode,
    config: ExamConfig,
    now: number,
    random = Math.random,
): Session {
    if (activeSession(state)) throw new Error("Resume or end your current session first.");
    const book = state.books.find((entry) => entry.book.id === bookId);
    if (!book) throw new Error("Select a book first.");
    if (
        !Number.isInteger(config.count) ||
        config.count < 1 ||
        (config.time !== "none" && (!Number.isFinite(config.seconds) || config.seconds < 1))
    )
        throw new Error("Invalid exam size or time limit.");
    let problems = candidates(state, book, mode, config, now);
    if (mode === "exam") {
        if (config.count > problems.length)
            throw new Error(
                `Only ${problems.length} problems are available. Adjust the exam size before starting.`,
            );
        for (let i = problems.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [problems[i], problems[j]] = [problems[j], problems[i]];
        }
        problems = problems.slice(0, config.count);
    }
    if (!problems.length)
        throw new Error(
            mode === "review"
                ? "No problems are due."
                : "No new problems available within today's limit.",
        );
    const session: Session = {
        id: crypto.randomUUID(),
        book: structuredClone(book.book),
        mode,
        config: structuredClone(config),
        status: "active",
        index: 0,
        interruptions: 0,
        createdAt: now,
        completedAt: null,
        attempts: problems.map((problem) => ({
            id: crypto.randomUUID(),
            problem: structuredClone(problem),
            fen: problem.fen,
            path: [],
            errors: 0,
            hinted: false,
            revealed: false,
            actions: [],
            result: null,
            elapsedMs: 0,
            runningSince: null,
            startedAt: null,
            finishedAt: null,
        })),
    };
    state.sessions.push(session);
    state.activeId = session.id;
    beginAttempt(currentAttempt(session), now);
    return session;
}
function beginAttempt(attempt: Attempt, now: number) {
    if (attempt.result) return;
    attempt.startedAt ??= now;
    attempt.runningSince = now;
}
export function elapsed(attempt: Attempt, now: number): number {
    return (
        attempt.elapsedMs +
        (attempt.runningSince === null ? 0 : Math.max(0, now - attempt.runningSince))
    );
}
function checkpoint(attempt: Attempt, now: number) {
    attempt.elapsedMs = elapsed(attempt, now);
    if (attempt.runningSince !== null) attempt.runningSince = now;
}
function finish(state: TrainingState, session: Session, reason: Reason, now: number) {
    const attempt = currentAttempt(session);
    if (attempt.result) return;
    checkpoint(attempt, now);
    attempt.runningSince = null;
    attempt.finishedAt = now;
    attempt.result = reason;
    if (session.mode === "exam") return;
    const key = problemKey(session.book.id, attempt.problem.id);
    const grade =
        reason === "correct" && !attempt.errors && !attempt.hinted && !attempt.revealed
            ? "Good"
            : "Again";
    if (state.logs.some((log) => log.attemptId === attempt.id)) return;
    const first = !state.cards[key];
    const card = state.cards[key]?.card ?? createEmptyCard(new Date(now));
    const scheduled = fsrs(
        generatorParameters({ request_retention: state.settings.retention, enable_fuzz: false }),
    ).repeat(card, new Date(now))[grade === "Good" ? Rating.Good : Rating.Again];
    state.cards[key] = {
        revision: revision(attempt.problem),
        card: JSON.parse(JSON.stringify(scheduled.card)),
    };
    state.logs.push({
        attemptId: attempt.id,
        key,
        grade,
        at: now,
        day: studyDay(now, state.settings.timezone),
        first,
        log: JSON.parse(JSON.stringify(scheduled.log)),
    });
}
export function advance(state: TrainingState, session: Session, now: number) {
    if (!currentAttempt(session).result) return;
    if (session.index + 1 === session.attempts.length) {
        session.status = "complete";
        session.completedAt = now;
        state.activeId = null;
    } else {
        session.index++;
        beginAttempt(currentAttempt(session), now);
    }
}
export function tick(state: TrainingState, session: Session, now: number) {
    if (session.status !== "active") return;
    const speed = session.mode === "exam" && session.config.time !== "none";
    if (
        speed &&
        session.config.time === "total" &&
        now >= session.createdAt + session.config.seconds * 1000
    ) {
        const deadline = session.createdAt + session.config.seconds * 1000;
        while (session.status === "active") {
            if (!currentAttempt(session).result)
                finish(
                    state,
                    session,
                    "timeout",
                    Math.max(currentAttempt(session).startedAt ?? deadline, deadline),
                );
            // Unpresented questions must retain null startedAt and zero answer time.
            if (session.index + 1 === session.attempts.length) {
                session.status = "complete";
                session.completedAt = deadline;
                state.activeId = null;
            } else {
                session.index++;
            }
        }
        return;
    }
    const attempt = currentAttempt(session);
    if (
        speed &&
        session.config.time === "problem" &&
        attempt.startedAt !== null &&
        now >= attempt.startedAt + session.config.seconds * 1000 &&
        !attempt.result
    ) {
        finish(state, session, "timeout", attempt.startedAt + session.config.seconds * 1000);
        advance(state, session, now);
        return;
    }
    checkpoint(attempt, now);
}
export function pause(state: TrainingState, session: Session, now: number) {
    if (session.status !== "active" || (session.mode === "exam" && session.config.time !== "none"))
        return;
    checkpoint(currentAttempt(session), now);
    currentAttempt(session).runningSince = null;
    session.status = "paused";
    session.interruptions++;
}
export function resume(session: Session, now: number) {
    if (session.status !== "paused") return;
    session.status = "active";
    beginAttempt(currentAttempt(session), now);
}
export function abandon(state: TrainingState, session: Session, now: number) {
    checkpoint(currentAttempt(session), now);
    currentAttempt(session).runningSince = null;
    session.status = "abandoned";
    state.activeId = null;
}
export function submitMove(state: TrainingState, session: Session, uci: string, now: number) {
    if (!ready(state, session, now)) return;
    const attempt = currentAttempt(session);
    const [pos] = positionFromFen(attempt.fen);
    const move = parseUci(uci);
    if (!pos || !move || !pos.isLegal(move)) return;
    const choices = nextMoves(attempt);
    const index = choices.findIndex(
        (node) =>
            makeUci(normalizeMove(pos, parseUci(node.uci)!)) === makeUci(normalizeMove(pos, move)),
    );
    attempt.actions.push({ uci, correct: index !== -1, at: now });
    if (index === -1) {
        attempt.errors++;
        if (session.mode === "exam") {
            finish(state, session, "wrong", now);
            advance(state, session, now);
        }
        return;
    }
    pos.play(move);
    attempt.path.push(index);
    const reply = choices[index].children[0];
    if (reply) {
        const response = parseUci(reply.uci)!;
        pos.play(response);
        attempt.path.push(0);
    }
    attempt.fen = makeFen(pos.toSetup());
    if (!nextMoves(attempt).length) {
        finish(state, session, attempt.errors || attempt.hinted ? "wrong" : "correct", now);
        if (session.mode === "exam") advance(state, session, now);
    }
}
function ready(state: TrainingState, session: Session, now: number): boolean {
    const id = currentAttempt(session).id;
    tick(state, session, now);
    return (
        session.status === "active" &&
        currentAttempt(session).id === id &&
        !currentAttempt(session).result
    );
}
export function useHint(state: TrainingState, session: Session, now: number) {
    if (!ready(state, session, now) || (session.mode === "exam" && !session.config.hints)) return;
    const attempt = currentAttempt(session);
    attempt.hinted = true;
    if (session.mode === "exam") finish(state, session, "hint", now);
}
export function reveal(state: TrainingState, session: Session, now: number) {
    if (!ready(state, session, now) || (session.mode === "exam" && !session.config.reveal)) return;
    currentAttempt(session).revealed = true;
    finish(state, session, "reveal", now);
}
export function skip(state: TrainingState, session: Session, now: number) {
    if (session.mode !== "exam" || !ready(state, session, now)) return;
    finish(state, session, "skip", now);
    advance(state, session, now);
}
export function mainLine(problem: Problem): { san: string; fen: string; comment: string }[] {
    const [pos] = positionFromFen(problem.fen);
    if (!pos) return [];
    const line = [];
    let node = problem.solution[0];
    while (node) {
        const move = parseUci(node.uci)!;
        const san = makeSanAndPlay(pos, move);
        line.push({ san, fen: makeFen(pos.toSetup()), comment: node.comment });
        node = node.children[0];
    }
    return line;
}
export function statistics(session: Session, correctOnly = true) {
    const answered = session.attempts.filter((a) => a.result);
    const correct = answered.filter(
        (a) => a.result === "correct" && !a.errors && !a.hinted && !a.revealed,
    );
    const times = (correctOnly ? correct : answered.filter((a) => a.startedAt !== null))
        .map((a) => a.elapsedMs / 1000)
        .sort((a, b) => a - b);
    const n = times.length;
    return {
        correct: correct.length,
        incorrect: answered.length - correct.length,
        unanswered: session.attempts.length - answered.length,
        median: n ? (times[Math.floor((n - 1) / 2)] + times[Math.floor(n / 2)]) / 2 : null,
        p90: n ? times[Math.ceil(n * 0.9) - 1] : null,
        count: n,
    };
}
