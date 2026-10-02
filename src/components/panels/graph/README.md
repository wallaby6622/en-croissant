# Chess Graph integration

Adapted from https://github.com/NicoDeGiacomo/chess-graph at
`d0c288883310e1aba2895d3db9dacc6031d1ed4b` (MIT).
Copyright (c) 2025 Nicolas De Giacomo.
The full license is shipped in `public/licenses/chess-graph.txt`.

`graphLayout.ts`, `GraphPanel.tsx` and `TranspositionEdge.tsx` adapt the upstream
Dagre layout, React Flow canvas/node and transposition edge implementations.
En Croissant's TreeStore remains the source of truth. Its existing PGN import,
export, editing and saving also apply to the graph; no second database is created.
Graph nodes keep PGN paths so transpositions never discard distinct comments or
continuations. Dashed orange links identify equal positions (excluding FEN clocks).

Open a game or repertoire and select **Graph** in the board's right-hand tabs.
Click a node to navigate, play on the board to add moves, drag nodes to arrange,
use +/- or double-click to fold branches, and use the controls to zoom or fit.
The toolbar offers transposition links, expand all, auto-layout, current-position
focus, fullscreen, and a separate native graph window. The **Minimap** switch is
saved across sessions and shared between windows. Layout and folding are temporary
view state.

The separate window follows the source board and sends selection requests back to
it; move edits and saving remain on the main board. It closes when the source board
is unmounted (for example, when switching games or leaving the board page) or the
main window closes. Stale selection requests are validated against both path and
FEN. Engine evaluations are omitted from snapshots to avoid redundant IPC updates.

Opening names come from En Croissant's bundled opening database. Labels appear at
name changes and the start of branches, inheriting the last known opening along a
line. Unknown positions do not get invented names; move counters do not affect
recognition. Requests are batched and cached by position.

Each distinct opening name gets its own RGB color for the card border and text,
including moves that inherit a name without repeating its label. Colors are
allocated from all names in the tree (including folded branches), identically in
the board and detached views. Light and dark themes use suitable text lightness;
RGB collisions are resolved instead of cycling a fixed palette. Selection thickens
the border in the branch color. Card backgrounds, links, and minimap are unchanged.

Full MIT notices for Chess Graph, React Flow, and Dagre are available under
**Settings → Third-party licenses** and bundled in `public/licenses/`. No license
or library attribution is rendered on the graph canvas.

Detached graph windows reuse the main window's title bar, theme, font size, and
native/custom title bar preference. While a detached window is ready, the source
board temporarily hides its Graph tab and canvas, showing Analysis instead. Closing
the detached window restores Graph unless the user has selected another panel.
