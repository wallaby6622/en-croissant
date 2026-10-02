import { expect, test } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import {
    abandon,
    advance,
    candidates,
    currentAttempt,
    elapsed,
    emptyState,
    importBook,
    masteryDefaults,
    pause,
    problemKey,
    resume,
    reveal,
    revision,
    skip,
    startSession,
    statistics,
    studyDay,
    submitMove,
    tick,
    useHint,
    type BookData,
    type ExamConfig,
    type Problem,
    type SolutionMove,
} from "./model";

function line(...moves: string[]): SolutionMove[] {
    return moves.length ? [{ uci: moves[0], comment: "", children: line(...moves.slice(1)) }] : [];
}
const base: Problem = {
    id: "1",
    order: 1,
    chapter: "Chapter 1",
    page: "2",
    answerPage: "100",
    number: "1",
    fen: INITIAL_FEN,
    prompt: "Find the move",
    hints: ["Hint"],
    explanation: "Explanation",
    themes: ["theme"],
    solution: line("e2e4", "e7e5", "g1f3"),
};
const now = Date.parse("2026-10-02T06:00:00Z");
function setup(count = 1) {
    const state = emptyState();
    state.settings.timezone = "UTC";
    const book: BookData = {
        book: { id: "test", title: "Test", edition: "1" },
        problems: Array.from({ length: count }, (_, i) => ({
            ...structuredClone(base),
            id: String(i + 1),
            order: i + 1,
            number: String(i + 1),
            chapter: i < count / 2 ? "A" : "B",
        })),
    };
    importBook(state, book);
    return { state, book };
}
function exam(count: number, options: Partial<ExamConfig> = {}) {
    return { ...masteryDefaults, count, ...options };
}

test("book positions start on the solver's move and clean completion records Good once", () => {
    const { state } = setup();
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    expect(currentAttempt(session).fen).toBe(INITIAL_FEN);
    submitMove(state, session, "e2e4", now + 1000);
    expect(state.logs).toHaveLength(0);
    expect(currentAttempt(session).path).toEqual([0, 0]);
    submitMove(state, session, "g1f3", now + 2000);
    expect(state.logs.map((l) => l.grade)).toEqual(["Good"]);
    expect(state.cards[problemKey("test", "1")].card.reps).toBe(1);
    reveal(state, session, now + 3000);
    submitMove(state, session, "b1c3", now + 3000);
    expect(state.logs).toHaveLength(1);
});

test.each(["error", "hint", "reveal"])("%s records Again at the specified boundary", (action) => {
    const { state } = setup();
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    if (action === "error") submitMove(state, session, "d2d4", now + 1000);
    if (action === "hint") useHint(state, session, now + 1000);
    if (action === "reveal") reveal(state, session, now + 1000);
    expect(state.logs).toHaveLength(action === "reveal" ? 1 : 0);
    if (action !== "reveal") {
        submitMove(state, session, "e2e4", now + 2000);
        submitMove(state, session, "g1f3", now + 3000);
    }
    expect(state.logs.map((l) => l.grade)).toEqual(["Again"]);
});

test("unfinished learning never changes SRS, while resume keeps attempt identity and mistakes", () => {
    const { state } = setup();
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    submitMove(state, session, "d2d4", now + 1000);
    pause(state, session, now + 2000);
    expect(state.cards).toEqual({});
    expect(state.logs).toEqual([]);
    expect(elapsed(currentAttempt(session), now + 10000)).toBe(2000);
    const id = currentAttempt(session).id;
    resume(session, now + 10000);
    submitMove(state, session, "e2e4", now + 11000);
    submitMove(state, session, "g1f3", now + 12000);
    expect(currentAttempt(session).id).toBe(id);
    expect(currentAttempt(session).elapsedMs).toBe(4000);
    expect(state.logs[0].grade).toBe("Again");
});

test("Exam is completely isolated from existing cards and learning logs", () => {
    const { state } = setup(3);
    const learn = startSession(state, "test", "learn", masteryDefaults, now);
    reveal(state, learn, now + 1000);
    abandon(state, learn, now + 2000);
    const before = JSON.stringify([state.cards, state.logs]);
    const session = startSession(
        state,
        "test",
        "exam",
        exam(3, { reveal: true, hints: true }),
        now + 3000,
    );
    submitMove(state, session, "e2e4", now + 4000);
    submitMove(state, session, "g1f3", now + 5000);
    reveal(state, session, now + 6000);
    advance(state, session, now + 7000);
    useHint(state, session, now + 8000);
    advance(state, session, now + 9000);
    expect(session.status).toBe("complete");
    expect(statistics(session).correct).toBe(1);
    expect(JSON.stringify([state.cards, state.logs])).toBe(before);
});

test("random selection has no duplicates and cannot silently pad a small source", () => {
    const { state } = setup(120);
    expect(() => startSession(state, "test", "exam", exam(121), now)).toThrow("Only 120");
    const session = startSession(state, "test", "exam", exam(100), now, () => 0.2);
    expect(new Set(session.attempts.map((a) => a.problem.id)).size).toBe(100);
    expect(session.attempts.map((a) => a.problem.order)).not.toEqual(
        Array.from({ length: 100 }, (_, i) => i + 1),
    );
});

test("chapter and problem ranges select by book order", () => {
    const { state, book } = setup(10);
    expect(
        candidates(state, book, "exam", exam(2, { range: "chapter", chapter: "B" }), now),
    ).toHaveLength(5);
    expect(
        candidates(state, book, "exam", exam(2, { range: "problems", from: 3, to: 4 }), now).map(
            (p) => p.order,
        ),
    ).toEqual([3, 4]);
});

test("Reveal and hints are disabled by default; first wrong answer advances", () => {
    const { state } = setup(2);
    const session = startSession(state, "test", "exam", exam(2), now);
    reveal(state, session, now);
    useHint(state, session, now);
    expect(currentAttempt(session).result).toBeNull();
    expect(currentAttempt(session).hinted).toBe(false);
    submitMove(state, session, "d2d4", now + 1000);
    expect(session.index).toBe(1);
    expect(session.attempts[0].result).toBe("wrong");
    skip(state, session, now + 2000);
    expect(session.status).toBe("complete");
});

test("an alternative mating move is not accepted unless registered in the book", () => {
    const { state, book } = setup();
    book.problems[0].fen = "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1";
    book.problems[0].solution = line("g6g7");
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    submitMove(state, session, "g6g8", now + 1000);
    expect(currentAttempt(session).errors).toBe(1);
    expect(currentAttempt(session).result).toBeNull();
});

test("registered branches remain playable and change solution revision", () => {
    const { state, book } = setup();
    const before = revision(book.problems[0]);
    book.problems[0].solution.push(...line("d2d4", "d7d5", "c2c4"));
    expect(revision(book.problems[0])).not.toBe(before);
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    submitMove(state, session, "d2d4", now + 1000);
    submitMove(state, session, "c2c4", now + 2000);
    expect(currentAttempt(session).result).toBe("correct");
});

test("metadata updates preserve cards, solution updates reset cards and preserve historical snapshots", () => {
    const { state, book } = setup();
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    reveal(state, session, now + 1000);
    advance(state, session, now + 2000);
    const cards = JSON.stringify(state.cards);
    const updated = structuredClone(book);
    updated.problems[0].explanation = "Corrected";
    importBook(state, updated);
    expect(JSON.stringify(state.cards)).toBe(cards);
    updated.problems[0].solution = line("d2d4");
    importBook(state, updated);
    expect(state.cards).toEqual({});
    expect(session.attempts[0].problem.solution[0].uci).toBe("e2e4");
    expect(state.archives).toHaveLength(2);
});

test("due review is ordered by due time, and Learn observes the daily cap", () => {
    const { state, book } = setup(3);
    state.settings.newPerDay = 1;
    const session = startSession(state, "test", "learn", masteryDefaults, now);
    expect(session.attempts).toHaveLength(1);
    reveal(state, session, now + 1000);
    advance(state, session, now + 2000);
    expect(candidates(state, book, "learn", masteryDefaults, now)).toHaveLength(0);
    expect(candidates(state, book, "learn", masteryDefaults, now + 86400000)).toHaveLength(1);
    expect(candidates(state, book, "review", masteryDefaults, now + 86400000)[0].id).toBe("1");
});

test("study day rolls at local 04:00, including DST transitions", () => {
    expect(studyDay(Date.parse("2026-10-02T18:59:00Z"), "Asia/Tokyo")).toBe("2026-10-02");
    expect(studyDay(Date.parse("2026-10-02T19:00:00Z"), "Asia/Tokyo")).toBe("2026-10-03");
    expect(studyDay(Date.parse("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-07");
});

test("total timeout records unpresented questions separately and never updates SRS", () => {
    const { state } = setup(3);
    const session = startSession(
        state,
        "test",
        "exam",
        exam(3, { time: "total", seconds: 60 }),
        now,
    );
    pause(state, session, now + 1000);
    expect(session.status).toBe("active");
    tick(state, session, now + 70000);
    expect(session.status).toBe("complete");
    expect(session.attempts.map((a) => a.result)).toEqual(["timeout", "timeout", "timeout"]);
    expect(session.attempts.map((a) => a.startedAt)).toEqual([now, null, null]);
    expect(statistics(session, false).count).toBe(1);
    expect(state.logs).toEqual([]);
});

test("a move after the per-problem deadline is not applied to the next question", () => {
    const { state } = setup(2);
    const session = startSession(
        state,
        "test",
        "exam",
        exam(2, { time: "problem", seconds: 60 }),
        now,
    );
    submitMove(state, session, "e2e4", now + 61000);
    expect(session.index).toBe(1);
    expect(currentAttempt(session).actions).toEqual([]);
    expect(session.attempts[0].elapsedMs).toBe(60000);
});

test("median and nearest-rank P90 distinguish complete first-try and all answers", () => {
    const { state } = setup(4);
    const session = startSession(state, "test", "exam", exam(4), now);
    session.attempts.forEach((a, i) => {
        a.result = i === 3 ? "wrong" : "correct";
        a.startedAt = now;
        a.elapsedMs = [1000, 2000, 10000, 200][i];
    });
    expect(statistics(session)).toMatchObject({ median: 2, p90: 10, correct: 3, incorrect: 1 });
    expect(statistics(session, false).median).toBe(1.5);
});

test("Review schedules an existing card after persistence round-trip without creating a new card", () => {
    const { state } = setup();
    const learn = startSession(state, "test", "learn", masteryDefaults, now);
    reveal(state, learn, now + 1000);
    advance(state, learn, now + 2000);
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    const later = now + 86400000;
    const review = startSession(restored, "test", "review", masteryDefaults, later);
    submitMove(restored, review, "e2e4", later + 1000);
    submitMove(restored, review, "g1f3", later + 2000);
    expect(restored.cards[problemKey("test", "1")].card.reps).toBe(2);
    expect(restored.logs.map((log) => [log.grade, log.first])).toEqual([
        ["Again", true],
        ["Good", false],
    ]);
});

test("standard castling accepts both Chessground input representations", () => {
    for (const uci of ["e1g1", "e1h1"]) {
        const { state, book } = setup();
        book.problems[0].fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
        book.problems[0].solution = line("e1g1");
        const session = startSession(state, "test", "learn", masteryDefaults, now);
        submitMove(state, session, uci, now + 1000);
        expect(currentAttempt(session).result).toBe("correct");
    }
});
