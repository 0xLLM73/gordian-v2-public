'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { GraphData, GraphNode } from '@/app/actions/network';
// Canvas API is browser-only — must use next/dynamic with ssr:false
import { getNetworkGraphAction } from '@/app/actions/network';
import { HEALTH_HEX_COLORS } from '@/lib/colors';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const LEGEND_LABELS: Array<{ label: string; color: string }> = [
	{ label: 'Thriving', color: HEALTH_HEX_COLORS.thriving },
	{ label: 'Healthy', color: HEALTH_HEX_COLORS.healthy },
	{ label: 'Cooling', color: HEALTH_HEX_COLORS.cooling },
	{ label: 'Dormant', color: HEALTH_HEX_COLORS.dormant },
	{ label: 'Unknown', color: HEALTH_HEX_COLORS.unknown },
];

interface SelectedNode extends GraphNode {}

export function NetworkGraph() {
	const [isPending, startTransition] = useTransition();
	const [graphData, setGraphData] = useState<GraphData | null>(null);
	const [minStrength, setMinStrength] = useState(0);
	const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [dimensions, setDimensions] = useState({ width: 700, height: 500 });

	const loadGraph = useCallback((strength: number) => {
		startTransition(async () => {
			const result = await getNetworkGraphAction({
				minStrength: strength > 0 ? strength : undefined,
			});
			if (result?.data) {
				setGraphData(result.data);
			} else {
				setError('Failed to load network data');
			}
		});
	}, []);

	useEffect(() => {
		loadGraph(0);
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

	function handleStrengthChange(e: React.ChangeEvent<HTMLInputElement>) {
		const value = Number(e.target.value);
		setMinStrength(value);
		loadGraph(value);
	}

	function handleNodeClick(node: object) {
		const n = node as GraphNode;
		setSelectedNode(n);
	}

	if (isPending && !graphData) {
		return <p className="text-sm text-muted-foreground">Loading network graph...</p>;
	}

	if (error) {
		return <p className="text-sm text-red-600">{error}</p>;
	}

	if (graphData && graphData.nodes.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
				<svg
					className="mb-4 h-12 w-12 text-gray-300"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={1}
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
					/>
				</svg>
				<h3 className="mb-1 text-sm font-medium text-foreground">No relationships yet</h3>
				<p className="text-sm text-muted-foreground">
					Relationships are extracted automatically as your contacts sync.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card px-4 py-3">
				{/* Strength filter */}
				<div className="flex items-center gap-3">
					<label
						htmlFor="strengthFilter"
						className="text-sm font-medium text-foreground whitespace-nowrap"
					>
						Min strength: <span className="text-primary">{minStrength.toFixed(1)}</span>
					</label>
					<input
						id="strengthFilter"
						type="range"
						min={0}
						max={1}
						step={0.1}
						value={minStrength}
						onChange={handleStrengthChange}
						className="w-28 accent-blue-600"
					/>
				</div>

				{/* Legend */}
				<div className="flex flex-wrap items-center gap-3">
					{LEGEND_LABELS.map(({ label, color }) => (
						<span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<span
								className="inline-block h-3 w-3 rounded-full"
								style={{ backgroundColor: color }}
							/>
							{label}
						</span>
					))}
				</div>

				{isPending ? <span className="text-xs text-muted-foreground">Updating...</span> : null}
			</div>

			{/* Graph + detail panel */}
			<div className="flex gap-4">
				{/* Graph canvas — responsive via ResizeObserver */}
				<div
					ref={containerRef}
					className="flex-1 overflow-hidden rounded-lg border border-border bg-muted"
					style={{ minHeight: 400 }}
				>
					{graphData ? (
						<ForceGraph2D
							graphData={{
								nodes: graphData.nodes.map((n) => ({ ...n })),
								links: graphData.links.map((l) => ({ ...l })),
							}}
							nodeId="id"
							nodeLabel="name"
							nodeCanvasObject={(node, ctx, globalScale) => {
								const n = node as GraphNode & { x: number; y: number };
								const color = HEALTH_HEX_COLORS[n.healthLabel] ?? HEALTH_HEX_COLORS.unknown;
								const radius = Math.max(4, Math.sqrt(n.connectionCount) * 4);

								// Draw circle
								ctx.beginPath();
								ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
								ctx.fillStyle = color;
								ctx.fill();
								ctx.strokeStyle = '#fff';
								ctx.lineWidth = 1.5;
								ctx.stroke();

								// Draw label below node
								const fontSize = Math.max(10, 12 / globalScale);
								ctx.font = `${fontSize}px sans-serif`;
								ctx.textAlign = 'center';
								ctx.textBaseline = 'top';
								ctx.fillStyle = '#374151';
								ctx.fillText(n.name, n.x, n.y + radius + 2);
							}}
							nodePointerAreaPaint={(node, color, ctx) => {
								const n = node as GraphNode & { x: number; y: number };
								const radius = Math.max(4, Math.sqrt(n.connectionCount) * 4);
								ctx.beginPath();
								ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI);
								ctx.fillStyle = color;
								ctx.fill();
							}}
							linkWidth={(link) => {
								const l = link as { strength: number };
								return Math.max(0.5, (l.strength ?? 0.5) * 3);
							}}
							onNodeClick={handleNodeClick}
							width={dimensions.width}
							height={dimensions.height}
							backgroundColor="#f9fafb"
						/>
					) : null}
				</div>

				{/* Detail panel */}
				{selectedNode ? (
					<div className="w-56 shrink-0 rounded-lg border border-border bg-card p-4">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-sm font-semibold text-foreground">Contact</h3>
							<button
								type="button"
								onClick={() => setSelectedNode(null)}
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								&#x2715;
							</button>
						</div>
						<p className="mb-3 text-sm font-medium text-foreground">{selectedNode.name}</p>
						<div className="space-y-2 text-xs text-muted-foreground">
							<div className="flex items-center justify-between">
								<span>Health</span>
								<span
									className="rounded-full px-2 py-0.5 text-white text-xs font-medium capitalize"
									style={{
										backgroundColor:
											HEALTH_HEX_COLORS[selectedNode.healthLabel] ?? HEALTH_HEX_COLORS.unknown,
									}}
								>
									{selectedNode.healthLabel}
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span>Score</span>
								<span className="font-medium text-foreground">
									{(selectedNode.composite * 100).toFixed(0)}%
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span>Connections</span>
								<span className="font-medium text-foreground">{selectedNode.connectionCount}</span>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
