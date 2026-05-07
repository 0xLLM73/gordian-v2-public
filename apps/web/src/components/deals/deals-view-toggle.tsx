'use client';

import { useState } from 'react';

export function DealsViewToggle({
	listView,
	kanbanView,
}: {
	listView: React.ReactNode;
	kanbanView: React.ReactNode;
}) {
	const [view, setView] = useState<'list' | 'kanban'>('list');

	return (
		<div>
			<div className="mb-4 flex w-fit gap-1 rounded-lg border border-border p-0.5">
				<button
					type="button"
					onClick={() => setView('list')}
					className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
						view === 'list'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					List
				</button>
				<button
					type="button"
					onClick={() => setView('kanban')}
					className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
						view === 'kanban'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Board
				</button>
			</div>
			{view === 'list' ? listView : kanbanView}
		</div>
	);
}
