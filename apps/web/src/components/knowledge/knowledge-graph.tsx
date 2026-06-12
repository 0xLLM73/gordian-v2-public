'use client';

// Client boundary: Canvas API is browser-only, react-force-graph-2d requires dynamic import with ssr:false

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { getGraphDataAction } from '@/app/actions/knowledge';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const TYPE_HEX_COLORS: Record<string, string> = {
	topic: '#3b82f6',
	project: '#6366f1',
	organization: '#22c55e',
	technology: '#a855f7',
	sector: '#f97316',
	concept: '#6b7280',
};

const LEGEND: Array<{ label: string; color: string }> = [
	{ label: 'Topic', color: TYPE_HEX_COLORS.topic },
	{ label: 'Project', color: TYPE_HEX_COLORS.project },
	{ label: 'Organization', color: TYPE_HEX_COLORS.organization },
	{ label: 'Technology', color: TYPE_HEX_COLORS.technology },
	{ label: 'Sector', color: TYPE_HEX_COLORS.sector },
	{ label: 'Concept', color: TYPE_HEX_COLORS.concept },
];

interface GraphNode {
	id: string;
	name: string;
	displayName: string;
	type: string;
	mentionCount: number;
	color: string;
	val: number;
	x?: number;
	y?: number;
}

interface GraphLink {
	source: string;
	target: string;
	linkType: string;
	weight: number | null;
}

function graphSummary(data: { nodes: GraphNode[]; links: GraphLink[] }) {
	const connectedNodeIds = new Set<string>();
	for (const link of data.links) {
		connectedNodeIds.add(link.source);
		connectedNodeIds.add(link.target);
	}

	return {
		nodeCount: data.nodes.length,
		linkCount: data.links.length,
		connectedNodeCount: connectedNodeIds.size,
		isolatedNodeCount: Math.max(0, data.nodes.length - connectedNodeIds.size),
	};
}

export function KnowledgeGraph() {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] } | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [dimensions, setDimensions] = useState({ width: 700, height: 500 });

	const loadGraph = useCallback(() => {
		startTransition(async () => {
			const result = await getGraphDataAction({ maxNodes: 200 });
			if (result?.data) {
				const nodes = result.data.nodes.map((n) => ({
					id: n.id,
					name: n.name,
					displayName: n.displayName,
					type: n.type,
					mentionCount: n.mentionCount ?? 0,
					color: TYPE_HEX_COLORS[n.type] ?? TYPE_HEX_COLORS.concept,
					val: Math.max(1, n.mentionCount ?? 1),
				}));
				const links = result.data.links.map((l) => ({
					source: l.sourceNodeId,
					target: l.targetNodeId,
					linkType: l.linkType,
					weight: l.weight,
				}));
				setGraphData({ nodes, links });
			} else {
				setError('Failed to load knowledge graph');
			}
		});
	}, []);

	useEffect(() => {
		loadGraph();
	}, [loadGraph]);

	// Responsive sizing via ResizeObserver
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				if (width > 0 && height > 0) {
					setDimensions({ width: Math.round(width), height: Math.round(height) });
				}
			}
		});

		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	function handleNodeClick(node: object) {
		const n = node as GraphNode;
		router.push(`/knowledge/${n.id}`);
	}

	if (isPending && !graphData) {
		return <p className="py-8 text-center text-sm text-muted-foreground">Loading graph...</p>;
	}

	if (error) {
		return <p className="text-sm text-red-600">{error}</p>;
	}

	if (graphData && graphData.nodes.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
				<h3 className="mb-1 text-sm font-medium text-foreground">No knowledge nodes yet</h3>
				<p className="text-sm text-muted-foreground">
					Sync messages to extract knowledge from your conversations.
				</p>
			</div>
		);
	}

	const summary = graphData ? graphSummary(graphData) : null;

	return (
		<div className="space-y-4">
			{/* Legend */}
			<div className="flex flex-wrap items-center gap-3">
				{LEGEND.map(({ label, color }) => (
					<span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							className="inline-block h-3 w-3 rounded-full"
							style={{ backgroundColor: color }}
						/>
						{label}
					</span>
				))}
				{isPending ? <span className="text-xs text-muted-foreground">Updating...</span> : null}
			</div>

			{summary ? (
				<div className="rounded-lg border border-border bg-card p-3">
					<div className="grid gap-2 text-sm sm:grid-cols-4">
						<GraphMetric label="Nodes" value={summary.nodeCount} />
						<GraphMetric label="Relationships" value={summary.linkCount} />
						<GraphMetric label="Connected nodes" value={summary.connectedNodeCount} />
						<GraphMetric label="Needs relationships" value={summary.isolatedNodeCount} />
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						{summary.linkCount > 0
							? 'Click a node to open its topic. Relationship thickness reflects link strength.'
							: 'Build relationships after analysis to connect isolated topics in the graph.'}
					</p>
				</div>
			) : null}

			{/* Graph canvas */}
			<div
				ref={containerRef}
				className="overflow-hidden rounded-lg border border-border bg-muted"
				style={{ minHeight: 500 }}
			>
				{graphData ? (
					<ForceGraph2D
						graphData={{
							nodes: graphData.nodes.map((n) => ({ ...n })),
							links: graphData.links.map((l) => ({ ...l })),
						}}
						nodeId="id"
						nodeLabel="displayName"
						nodeCanvasObject={(node, ctx, globalScale) => {
							const n = node as GraphNode & { x: number; y: number };
							const radius = Math.max(4, Math.sqrt(n.mentionCount) * 3);

							ctx.beginPath();
							ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
							ctx.fillStyle = n.color;
							ctx.fill();
							ctx.strokeStyle = '#fff';
							ctx.lineWidth = 1.5;
							ctx.stroke();

							const fontSize = Math.max(10, 12 / globalScale);
							ctx.font = `${fontSize}px sans-serif`;
							ctx.textAlign = 'center';
							ctx.textBaseline = 'top';
							ctx.fillStyle = '#374151';
							ctx.fillText(n.displayName, n.x, n.y + radius + 2);
						}}
						nodePointerAreaPaint={(node, color, ctx) => {
							const n = node as GraphNode & { x: number; y: number };
							const radius = Math.max(4, Math.sqrt(n.mentionCount) * 3) + 4;
							ctx.beginPath();
							ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
							ctx.fillStyle = color;
							ctx.fill();
						}}
						linkWidth={(link) => {
							const l = link as GraphLink;
							return Math.max(0.5, (l.weight ?? 0.5) * 3);
						}}
						linkColor={() => '#d1d5db'}
						onNodeClick={handleNodeClick}
						width={dimensions.width}
						height={dimensions.height}
						backgroundColor="#f9fafb"
					/>
				) : null}
			</div>
		</div>
	);
}

function GraphMetric({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-md border border-border bg-background px-3 py-2">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-sm font-medium text-foreground">
				{new Intl.NumberFormat().format(value)}
			</div>
		</div>
	);
}
