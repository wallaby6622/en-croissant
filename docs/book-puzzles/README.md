# Book puzzles

Open **Puzzle training → Book puzzle training → Import book .db3**. Import displays
valid/excluded counts and reasons before installing the valid problems. The supplied
source file is opened read-only and is never modified. There is no book/PDF/OCR
extraction in En Croissant.

## External extraction contract

The external producer owns the JSON document defined by `schema.json`. Package it
using `schema.sql`, with book metadata in its single metadata row, and one JSON
problem payload per problem row. `problem_id` and `sort_order` must match `id` and
`order` in the payload. Schema version 1 is required. Unknown versions and duplicate
IDs/orders reject the import; invalid individual problems are reported and excluded.

IDs must remain stable across corrections. Use a distinct book ID for a different
edition whose problem identities differ. `order` is a positive, unique integer for
book order and numeric range selection; `number` is the printed label (such as
“12b”). Page fields are strings and may contain ranges. A problem begins directly
at its FEN, with the solver to move; do not prepend an opponent setup move.

`solution` is a list of registered alternatives. Each node has a UCI move, optional
comment and child alternatives. The first child is the automatic opponent reply.
Every leaf must end on a solver move. All branches must be legal from the FEN.
Only registered moves are accepted, including mating moves. The initial producer
should register the book line only; the recursive format accommodates future
explicitly accepted branches. Standard chess (including promotions and castling)
is supported. Solution limits: 128 ply depth, 4096 nodes per problem.

Separate hints, explanations, themes and move comments from the public `prompt`.
Provide a neutral `examPrompt` when the original wording discloses chapter/theme
information or the answer. If absent, Exam uses `prompt`. The app cannot infer
which words in an externally authored prompt are spoilers. Text is rendered as
plain text, not executable HTML. Book, edition, chapter, problem page, answer page
and printed number are retained.

`example.json` contains two original synthetic examples, not material extracted
from a published book. To create a database for testing:

```sh
python3 docs/book-puzzles/pack.py docs/book-puzzles/example.json /tmp/book-demo.db3
```

The optional packer only packages already extracted JSON; En Croissant validates
positions and every solution branch during import.

## Learn and Review

Learn selects unseen problems in book order, up to the remaining daily allowance.
Review selects due FSRS cards, oldest due first, breaking ties by book order. Both
modes share one card per book/problem ID. Initial settings: 90% retention, 20 new
problems/day, system timezone, study-day boundary 04:00. New-problem allowance is
global across books. Settings affect future scheduling; they do not rewrite logs.

A complete clean solution is Good. Any wrong move or Hint marks the attempt Again
when completed. Show solution/Reveal finalizes Again immediately. Wrong moves are
returned to the current position, permitting retries. Pausing or leaving an
unfinished attempt does not update FSRS. Resume retains its mistakes, hint usage,
position and elapsed time. Ending a session keeps its unfinished record, with no
SRS update for the pending problem. Review results and the card/log are committed
in the same transaction and each attempt can be finalized only once.

## Exam

Mastery defaults: all problems, 100 sampled without replacement, no time limit,
no hints or Reveal. A smaller range requires an explicit count adjustment before
starting. The “12 / 100” indicator is the exam position, not the book number.
Book numbers, chapters, themes, explanations, solution comments and cumulative
scores are hidden while an exam is active or paused. Wrong moves finalize incorrect
and advance. Skip finalizes incorrect. If enabled, Hint or Reveal finalizes
incorrect immediately; Reveal shows the solution before Continue. Exam never
writes cards or SRS logs, even when replaying a previously learned problem.

Untimed exams can pause; question text and board are hidden. The same sampled
questions/order are resumed, and interruptions are recorded. Timed total/per-problem
options also exist. They cannot pause and their wall-clock deadlines survive
closing/reopening. Total expiry marks all remaining problems timeout, distinguishing
unpresented questions (null start time); a per-problem expiry times out the current
question, starting the next when it is presented. Ending early records an incomplete
session rather than a completed assessment.

Answer timing excludes explicit pauses. Opponent moves apply instantly (no reply
animation). Merely losing focus does not pause. A normal close/exit from this screen
saves paused progress; active sessions checkpoint every five seconds. After a crash,
untimed attempts resume paused at the last saved checkpoint (up to five seconds of
active timing may be lost); timed deadlines still run.

Results include reasons, submitted moves, assistance, source details and reviewable
solution positions. Primary Median/P90 use complete first-try results only; a
separate view includes all presented, finalized answers. Median averages the central
two observations for even samples; P90 uses nearest rank `ceil(0.9*n)`. Empty samples
show a dash. Unpresented timeouts never contribute zero-duration timing observations.
No pass/fail is assigned by default; an optional target percentage is user-defined.

## Persistence and updates

The application-data directory contains `book-training.db3`, separate from all
source databases. It contains imported book snapshots and user progress. A SQLite
transaction writes a versioned state snapshot with an expected revision; stale
writers cannot overwrite another window's progress. On a write error, gameplay
stops and the screen offers reload of the last saved state. Back up this database
to preserve the library, cards, logs, unfinished sessions and exam results.

Reimporting a book archives its preceding content. Metadata/comment changes retain
cards. Changing a problem's position or registered move tree removes its current
card, making it unseen. Historical logs and attempt snapshots remain unchanged.
An unfinished session for that book must be finished or ended before reimporting.
