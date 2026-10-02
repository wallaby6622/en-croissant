import { commands } from "@/bindings";
import { useEffect, useMemo, useState } from "react";
import { graphNodeId, positionKey, type MoveFlowNode } from "./graphLayout";

const cache = new Map<string, string | null>();

/** Inherit known names along a line, but display labels only at new names and forks. */
export function labelOpenings(
    nodes: MoveFlowNode[],
    names: ReadonlyMap<string, string | null>,
): MoveFlowNode[] {
    const inherited = new Map<string, string>();
    const childCounts = new Map<string, number>();
    for (const node of nodes) {
        if (node.data.path.length) {
            const parent = graphNodeId(node.data.path.slice(0, -1));
            childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
        }
    }
    return nodes.map((node) => {
        const parentId = graphNodeId(node.data.path.slice(0, -1));
        const parentName = node.data.path.length ? inherited.get(parentId) : undefined;
        const exactName = names.get(positionKey(node.data.fen));
        const name = exactName || parentName;
        if (name) inherited.set(node.id, name);
        const showName =
            name &&
            (name !== parentName ||
                (node.data.path.length > 0 && (childCounts.get(parentId) ?? 0) > 1));
        return {
            ...node,
            data: { ...node.data, openingName: showName ? name : undefined, branchName: name },
        };
    });
}

export function useOpeningNames(nodes: MoveFlowNode[]) {
    const [names, setNames] = useState<ReadonlyMap<string, string | null>>(new Map());
    useEffect(() => {
        let cancelled = false;
        const unique = new Map(nodes.map((node) => [positionKey(node.data.fen), node.data.fen]));
        const missing = [...unique.entries()].filter(([key]) => !cache.has(key));
        async function load() {
            for (let i = 0; i < missing.length; i += 256) {
                if (cancelled) return;
                const batch = missing.slice(i, i + 256);
                const result = await commands.getGraphOpeningNames(batch.map(([, fen]) => fen));
                batch.forEach(([key], index) => cache.set(key, result[index] ?? null));
            }
            if (!cancelled) setNames(new Map(cache));
        }
        void load().catch((error) => console.error("Opening names lookup failed", error));
        return () => {
            cancelled = true;
        };
    }, [nodes]);
    return useMemo(() => labelOpenings(nodes, names), [nodes, names]);
}
