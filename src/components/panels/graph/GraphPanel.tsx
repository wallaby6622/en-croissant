// GraphCanvas / MoveNode adapted from Chess Graph (MIT).
// Copyright (c) 2025 Nicolas De Giacomo. See public/licenses/chess-graph.txt.
import {
  ActionIcon,
  Alert,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconFocus2,
  IconLayoutDistributeHorizontal,
  IconMinus,
  IconPlus,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAtom } from "jotai";
import { graphMinimapAtom } from "./preferences";
import { useOpeningNames } from "./useOpeningNames";
import { useTranslation } from "react-i18next";
import { memoize } from "proxy-memoize";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import type { TreeStoreState } from "@/state/store/tree";
import {
  collectGraphNodes,
  computeLayout,
  graphNodeId,
  GRAPH_NODE_WIDTH,
  graphNodeHeight,
  type MoveFlowNode,
} from "./graphLayout";
import { TranspositionEdge } from "./TranspositionEdge";
import classes from "./GraphPanel.module.css";
import { branchColors } from "./branchColors";

const CollapseContext = createContext<(id: string) => void>(() => {});
const BranchColorsContext = createContext<ReadonlyMap<string, string>>(new Map());
const MoveNode = memo(function MoveNode({ id, data, selected }: NodeProps<MoveFlowNode>) {
  const toggle = useContext(CollapseContext);
  const colors = useContext(BranchColorsContext);
  const color = data.branchName ? colors.get(data.branchName) : undefined;
  const { t } = useTranslation();
  return (
    <div
      className={classes.node}
      data-selected={selected || undefined}
      title={[data.openingName, data.comment, data.fen].filter(Boolean).join("\n")}
      style={{ height: data.openingName ? 122 : 56, "--branch-color": color } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} className={classes.handle} />
      <div className={classes.label}>
        <Text size="sm" fw={600} c="inherit" truncate>
          {data.move || t("Graph.Start")}
        </Text>
        {data.openingName && (
          <Text
            className={classes.openingName}
            size="xs"
            fw={600}
            c="inherit"
            lineClamp={3}
            title={data.openingName}
          >
            {data.openingName}
          </Text>
        )}
        <Text size="xs" c={color ? "inherit" : "dimmed"} truncate>
          {data.annotations.join(" ")}
          {data.comment ? ` ${data.comment}` : ""}
        </Text>
      </div>
      {data.hasChildren && (
        <ActionIcon
          size="xs"
          variant="subtle"
          className="nodrag nopan"
          aria-label={data.collapsed ? t("Graph.Expand") : t("Graph.Collapse")}
          onClick={(event) => {
            event.stopPropagation();
            toggle(id);
          }}
        >
          {data.collapsed ? <IconPlus size={12} /> : <IconMinus size={12} />}
        </ActionIcon>
      )}
      <Handle type="source" position={Position.Right} className={classes.handle} />
    </div>
  );
});
const nodeTypes: NodeTypes = { move: MoveNode };
const edgeTypes = { transposition: TranspositionEdge };

interface GraphPanelProps {
  onOpenWindow?: () => void;
  windowError?: string | null;
  detached?: boolean;
  onNavigate?: (path: number[], fen: string) => void;
}

function GraphCanvas({
  fullscreen,
  onFullscreen,
  onOpenWindow,
  windowError,
  detached,
  onNavigate,
}: GraphPanelProps & {
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  // Track only graph data: engine score updates must not run Dagre again.
  const selectNodes = useMemo(
    () => memoize((state: TreeStoreState) => collectGraphNodes(state.root)),
    [],
  );
  const rawNodes = useStore(store, selectNodes);
  const allNodes = useOpeningNames(rawNodes);
  const [showMinimap, setShowMinimap] = useAtom(graphMinimapAtom);
  const position = useStore(store, (state) => state.position);
  const goToMove = useStore(store, (state) => state.goToMove);
  const selectedId = graphNodeId(position);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [transpositions, setTranspositions] = useState(true);
  const theme = useComputedColorScheme("dark");
  const colors = useMemo(
    () =>
      branchColors(
        allNodes.flatMap((node) => (node.data.branchName ? [node.data.branchName] : [])),
        theme,
      ),
    [allNodes, theme],
  );
  const flow = useReactFlow<MoveFlowNode>();
  const dragged = useRef(new Map<string, { x: number; y: number }>());
  const layout = useMemo(
    () => computeLayout(allNodes, collapsed, transpositions),
    [allNodes, collapsed, transpositions],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<MoveFlowNode>(layout.nodes);

  useEffect(() => {
    const ids = new Set(allNodes.map((node) => node.id));
    for (const id of dragged.current.keys()) if (!ids.has(id)) dragged.current.delete(id);
    setNodes(
      layout.nodes.map((node) => ({
        ...node,
        position: dragged.current.get(node.id) ?? node.position,
      })),
    );
  }, [layout.nodes, allNodes, setNodes]);

  // Reveal a move selected in the board or notation, even in a folded branch.
  useEffect(() => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (let i = 0; i < position.length; i++) next.delete(graphNodeId(position.slice(0, i)));
      return next.size === previous.size ? previous : next;
    });
  }, [position]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const visibleNodes = nodes.map((node) => ({ ...node, selected: node.id === selectedId }));
  const fit = () => void flow.fitView({ padding: 0.2, duration: 200 });
  const focus = () => {
    const node = nodes.find((entry) => entry.id === selectedId);
    if (node)
      void flow.setCenter(
        node.position.x + GRAPH_NODE_WIDTH / 2,
        node.position.y + graphNodeHeight(node) / 2,
        { zoom: 1, duration: 200 },
      );
  };

  return (
    <Stack gap={0} className={classes.panel}>
      {windowError && (
        <Alert color="red" title={t("Graph.WindowError")}>
          {windowError}
        </Alert>
      )}
      <Group gap="xs" p="xs" justify="space-between">
        <Group gap="sm">
          <Switch
            size="xs"
            label={t("Graph.Transpositions")}
            checked={transpositions}
            onChange={(e) => setTranspositions(e.currentTarget.checked)}
          />
          <Switch
            size="xs"
            label={t("Graph.Minimap")}
            checked={showMinimap}
            onChange={(event) => setShowMinimap(event.currentTarget.checked)}
          />
        </Group>
        <Group gap={4}>
          {onOpenWindow && (
            <Tooltip label={t("Graph.OpenWindow")}>
              <ActionIcon
                variant="subtle"
                aria-label={t("Graph.OpenWindow")}
                onClick={onOpenWindow}
              >
                <IconExternalLink size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t("Graph.ExpandAll")}>
            <ActionIcon
              variant="subtle"
              aria-label={t("Graph.ExpandAll")}
              onClick={() => setCollapsed(new Set())}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Graph.Layout")}>
            <ActionIcon
              variant="subtle"
              aria-label={t("Graph.Layout")}
              onClick={() => {
                dragged.current.clear();
                setNodes(layout.nodes);
                requestAnimationFrame(fit);
              }}
            >
              <IconLayoutDistributeHorizontal size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Graph.Focus")}>
            <ActionIcon variant="subtle" aria-label={t("Graph.Focus")} onClick={focus}>
              <IconFocus2 size={16} />
            </ActionIcon>
          </Tooltip>
          {!detached && (
            <Tooltip label={t("Graph.Fullscreen")}>
              <ActionIcon
                variant="subtle"
                aria-label={t("Graph.Fullscreen")}
                onClick={onFullscreen}
              >
                {fullscreen ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <div className={classes.canvas}>
        <BranchColorsContext.Provider value={colors}>
          <CollapseContext.Provider value={toggleCollapse}>
            <ReactFlow<MoveFlowNode>
              nodes={visibleNodes}
              edges={layout.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={(_, node) => dragged.current.set(node.id, node.position)}
              onNodeClick={(_, node) =>
                onNavigate ? onNavigate(node.data.path, node.data.fen) : goToMove(node.data.path)
              }
              onNodeDoubleClick={(_, node) => toggleCollapse(node.id)}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              colorMode={theme}
              fitView
              minZoom={0.05}
              maxZoom={2}
              zoomOnDoubleClick={false}
              proOptions={{ hideAttribution: true }}
              onlyRenderVisibleElements
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              {showMinimap && <MiniMap pannable zoomable style={{ width: 120, height: 80 }} />}
            </ReactFlow>
          </CollapseContext.Provider>
        </BranchColorsContext.Provider>
      </div>
      <Group px="xs" py={4} gap="xs" justify="space-between">
        <Text size="xs" c="dimmed">
          {t("Graph.Hint")}
        </Text>
      </Group>
    </Stack>
  );
}

export default function GraphPanel(props: GraphPanelProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const { t } = useTranslation();
  if (fullscreen)
    return (
      <Modal
        opened
        onClose={() => setFullscreen(false)}
        fullScreen
        title={t("Board.Tabs.Graph")}
        styles={{ body: { height: "calc(100dvh - 70px)" } }}
      >
        <ReactFlowProvider>
          <GraphCanvas {...props} fullscreen onFullscreen={() => setFullscreen(false)} />
        </ReactFlowProvider>
      </Modal>
    );
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} fullscreen={false} onFullscreen={() => setFullscreen(true)} />
    </ReactFlowProvider>
  );
}
