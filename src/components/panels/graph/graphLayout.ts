// Adapted from Chess Graph's useGraphLayout.ts (MIT).
// Copyright (c) 2025 Nicolas De Giacomo. See public/licenses/chess-graph.txt.
import dagre from "dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { TreeNode } from "@/utils/treeReducer";

export type MoveFlowNode = Node<
    {
        path: number[];
        move: string;
        fen: string;
        comment: string;
        annotations: string[];
        hasChildren: boolean;
        collapsed: boolean;
        openingName?: string;
        branchName?: string;
    },
    "move"
>;
export const GRAPH_NODE_WIDTH = 240;
export const graphNodeHeight = (node: MoveFlowNode) => (node.data.openingName ? 122 : 56);

export type MoveFlowEdge = Edge<{ isTransposition: boolean; graphBottom?: number }>;

export const graphNodeId = (path: number[]) => `root${path.map((i) => `.${i}`).join("")}`;

// FEN clocks do not affect the position. Keep turn, castling and en-passant rights.
export const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** Preserve each PGN path, including distinct continuations after a transposition. */
export function collectGraphNodes(root: TreeNode): MoveFlowNode[] {
    const nodes: MoveFlowNode[] = [];
    const stack = [{ node: root, path: [] as number[] }];
    while (stack.length) {
        const { node, path } = stack.pop()!;
        nodes.push({
            id: graphNodeId(path),
            type: "move",
            position: { x: 0, y: 0 },
            data: {
                path,
                move: path.length
                    ? `${Math.ceil(node.halfMoves / 2)}${node.halfMoves % 2 ? "." : "..."} ${node.san ?? ""}`
                    : "",
                fen: node.fen,
                comment: node.comment,
                annotations: node.annotations,
                hasChildren: node.children.length > 0,
                collapsed: false,
            },
        });
        for (let i = node.children.length - 1; i >= 0; i--) {
            stack.push({ node: node.children[i], path: [...path, i] });
        }
    }
    return nodes;
}

export function computeLayout(
    allNodes: MoveFlowNode[],
    collapsed: Set<string>,
    showTranspositions: boolean,
) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const visible = new Set<string>();
    const nodes: MoveFlowNode[] = [];
    const edges: MoveFlowEdge[] = [];
    const positions = new Map<string, string>();
    for (const node of allNodes) {
        const path = node.data.path;
        const parentId = graphNodeId(path.slice(0, -1));
        if (path.length && (!visible.has(parentId) || collapsed.has(parentId))) continue;
        visible.add(node.id);
        nodes.push({ ...node, data: { ...node.data, collapsed: collapsed.has(node.id) } });
        g.setNode(node.id, { width: GRAPH_NODE_WIDTH, height: graphNodeHeight(node) });
        if (path.length) {
            g.setEdge(parentId, node.id);
            edges.push({
                id: `e-${node.id}`,
                source: parentId,
                target: node.id,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: { isTransposition: false },
            });
        }
        const key = positionKey(node.data.fen);
        const previous = positions.get(key);
        if (previous && showTranspositions) {
            // Exclude links from layout to avoid cycles, including repetitions.
            edges.push({
                id: `t-${node.id}`,
                source: node.id,
                target: previous,
                type: "transposition",
                style: { stroke: "#f59e0b", strokeDasharray: "5 5" },
                markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
                data: { isTransposition: true },
            });
        } else if (!previous) positions.set(key, node.id);
    }
    dagre.layout(g);
    let graphBottom = 0;
    for (const node of nodes) {
        const point = g.node(node.id);
        node.position = {
            x: point.x - GRAPH_NODE_WIDTH / 2,
            y: point.y - graphNodeHeight(node) / 2,
        };
        graphBottom = Math.max(graphBottom, point.y + graphNodeHeight(node) / 2);
    }
    for (const edge of edges) {
        if (edge.data?.isTransposition) edge.data.graphBottom = graphBottom;
    }
    return { nodes, edges };
}
