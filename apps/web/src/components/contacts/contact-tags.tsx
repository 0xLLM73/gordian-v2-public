'use client';

interface Tag {
	id: string;
	label: string;
	category: string;
}

interface Props {
	initialTags: Tag[];
}

export function ContactTagsDisplay({ initialTags }: Props) {
	if (initialTags.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-border p-4 text-center">
				<p className="text-sm text-muted-foreground">No tags yet.</p>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap gap-2">
			{initialTags.map((tag) => (
				<span
					key={tag.id}
					className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-primary"
				>
					{tag.label}
				</span>
			))}
		</div>
	);
}
