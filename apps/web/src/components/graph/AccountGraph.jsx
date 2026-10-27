import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { formatCurrencyCompact } from '../../utils/format.js';

/**
 * Account relationship graph.
 *
 * Nodes are synthetic accounts, edges are aggregated transaction flows. Both are
 * derived entirely from persisted rows — see `accounts.service.js`.
 *
 * ## Layout
 *
 * A radial layout around the focus account, computed deterministically from the
 * node list. A force simulation would look livelier but would also mean the
 * graph is different on every render, which makes it impossible for an
 * investigator to describe what they are looking at to a colleague.
 *
 * ## Visual encoding
 *
 * - node ring colour: whether the account is associated with open alerts;
 * - node size: total value flowing through the account;
 * - edge thickness: transfer count;
 * - edge colour: peak risk score on that flow.
 */

const NODE_WIDTH = 150;

/**
 * Deterministic radial layout: focus at the centre, neighbours on rings.
 *
 * Ring radii are derived from how many nodes sit on the ring rather than fixed,
 * so the gap between neighbouring cards stays constant as the graph grows. With
 * fixed radii a busy ring packs its cards into an unreadable arc, and `fitView`
 * then zooms the whole graph out to fit the widest ring — which is what makes a
 * dense relationship graph illegible.
 */
const MIN_ARC_PER_NODE = NODE_WIDTH + 56;

function layoutNodes(nodes, focusRef) {
  const focus = nodes.find((node) => node.accountRef === focusRef) ?? null;
  const others = nodes.filter((node) => node !== focus);

  // Most-connected accounts first, so the busiest sit nearest the centre and at
  // consistent angles between renders.
  const ordered = [...others].sort(
    (a, b) =>
      b.sentCount + b.receivedCount - (a.sentCount + a.receivedCount) ||
      a.accountRef.localeCompare(b.accountRef),
  );

  const positioned = [];
  if (focus) positioned.push({ node: focus, x: 0, y: 0 });

  // Ring capacities grow outwards; each ring's radius is then whichever is
  // larger of its nominal distance and the distance needed to space its own
  // nodes by `MIN_ARC_PER_NODE`.
  const capacities = [7, 13, 19, 25, 31];
  let index = 0;
  let ringIndex = 0;

  while (index < ordered.length && ringIndex < capacities.length) {
    const capacity = capacities[ringIndex];
    const slice = ordered.slice(index, index + capacity);
    const nominalRadius = 250 + ringIndex * 215;
    const requiredRadius = (slice.length * MIN_ARC_PER_NODE) / (2 * Math.PI);
    const radius = Math.max(nominalRadius, requiredRadius);

    slice.forEach((node, position) => {
      // Alternate rings are offset by half a step so cards on adjacent rings do
      // not line up radially and visually merge into spokes.
      const offset = ringIndex % 2 === 0 ? 0 : 0.5;
      const angle = ((position + offset) / slice.length) * Math.PI * 2 - Math.PI / 2;
      positioned.push({
        node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });

    index += capacity;
    ringIndex += 1;
  }

  // Anything beyond the last ring goes on a grid below, rather than being
  // dropped silently.
  ordered.slice(index).forEach((node, position) => {
    positioned.push({
      node,
      x: -900 + (position % 9) * (NODE_WIDTH + 40),
      y: 1700 + Math.floor(position / 9) * 110,
    });
  });

  return positioned;
}

/** Custom node: an account card. */
function AccountNode({ data }) {
  const hasOpenAlerts = data.openAlertCount > 0;
  const hasAlerts = data.alertCount > 0;

  return (
    <div
      className={clsx(
        'rounded-lg border bg-white/80 px-3 py-2 text-left shadow-glass transition-all',
        data.isFocus
          ? 'border-accent ring-2 ring-accent/40'
          : hasOpenAlerts
            ? 'border-risk-high/60'
            : hasAlerts
              ? 'border-risk-medium/50'
              : 'border-line-2',
        data.isSelected && 'ring-2 ring-accent/60',
      )}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-line-3"
      />
      <p className="truncate font-mono text-2xs text-fg" title={data.accountRef}>
        {data.accountRef}
      </p>
      <p className="truncate text-[10px] text-fg-faint">
        {data.displayName}
        {data.isMerchant ? ' · merchant' : ''}
      </p>
      <div className="tabular mt-1 flex items-center justify-between text-[10px]">
        <span className="text-fg-muted" title="Value sent">
          ↑ {formatCurrencyCompact(data.sentTotal)}
        </span>
        <span className="text-fg-muted" title="Value received">
          ↓ {formatCurrencyCompact(data.receivedTotal)}
        </span>
      </div>
      {hasAlerts ? (
        <p
          className={clsx(
            'tabular mt-1 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold',
            hasOpenAlerts ? 'bg-risk-high/15 text-risk-high' : 'bg-risk-medium/15 text-risk-medium',
          )}
        >
          {data.alertCount} alert{data.alertCount === 1 ? '' : 's'}
          {hasOpenAlerts ? ` · ${data.openAlertCount} open` : ''}
        </p>
      ) : null}
      {data.distinctSenders >= 8 && !data.isMerchant ? (
        <p className="tabular mt-1 text-center text-[10px] text-risk-high">
          {data.distinctSenders} distinct senders
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-line-3"
      />
    </div>
  );
}

const nodeTypes = { account: AccountNode };

export function AccountGraph({ graph, selectedRef, onSelect, className }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const laidOut = useMemo(() => layoutNodes(graph?.nodes ?? [], graph?.focusAccountRef), [graph]);

  useEffect(() => {
    setNodes(
      laidOut.map(({ node, x, y }) => ({
        id: node.id,
        type: 'account',
        position: { x, y },
        data: { ...node, isSelected: node.accountRef === selectedRef },
      })),
    );

    const maxTransfers = Math.max(1, ...(graph?.edges ?? []).map((edge) => edge.transferCount));

    setEdges(
      (graph?.edges ?? []).map((edge) => {
        const risk = edge.maxRiskScore ?? 0;
        const colour = risk >= 70 ? '#dc2626' : risk >= 30 ? '#d97706' : '#aab3cb';
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: risk >= 70,
          label: `${edge.transferCount}× ${formatCurrencyCompact(edge.totalAmount)}`,
          labelShowBg: true,
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.88 },
          labelStyle: { fill: '#525a79', fontSize: 9 },
          style: {
            stroke: colour,
            // Thickness scales with transfer count, floored so a single
            // transfer is still visible.
            strokeWidth: 1 + (edge.transferCount / maxTransfers) * 3.5,
            opacity: risk >= 30 ? 0.9 : 0.5,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 14, height: 14 },
        };
      }),
    );
  }, [laidOut, graph, selectedRef, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_event, node) => {
      onSelect?.(node.data.accountRef);
    },
    [onSelect],
  );

  if (!graph?.nodes?.length) {
    return (
      <div className={clsx('grid place-items-center p-10 text-center', className)}>
        <div>
          <p className="text-sm font-medium text-fg">No relationships to display</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">
            No transaction in the selected range matches the current filters. Try widening the date
            range, lowering the minimum amount, or reducing the minimum transfer count.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('h-full w-full', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.14, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        colorMode="light"
        // The graph is a read-only view of persisted data, so nothing here
        // should be editable: dragging a node must not imply it changed.
        nodesConnectable={false}
        edgesFocusable={false}
        nodesDraggable
      >
        <Background color="#c3cbe2" gap={24} size={1} />
        <Controls
          showInteractive={false}
          className="!border-line-2 !bg-white/80 [&>button]:!border-line [&>button]:!bg-surface-2 [&>button]:!fill-fg-muted"
        />
      </ReactFlow>
    </div>
  );
}

/** Legend explaining the visual encoding, shown beside the canvas. */
export function GraphLegend() {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border-2 border-accent" aria-hidden="true" />
        <dt className="text-fg-muted">Focus account</dt>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border-2 border-risk-high/60" aria-hidden="true" />
        <dt className="text-fg-muted">Has open alerts</dt>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-0.5 w-5 bg-risk-high" aria-hidden="true" />
        <dt className="text-fg-muted">Flow with a high-risk transaction</dt>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-0.5 w-5 bg-line-2" aria-hidden="true" />
        <dt className="text-fg-muted">Low-risk flow</dt>
      </div>
      <div className="col-span-2 mt-1 text-fg-faint">
        Edge thickness is the number of transfers; the label shows transfer count and total value.
        Every node and edge is derived from stored transactions.
      </div>
    </dl>
  );
}
