import { getContactInitial } from '@/lib/contact-initial';
import { cn } from '@/lib/utils';

interface ContactBubbleProps {
	firstName: string;
	lastName: string;
	index: number;
}

const BUBBLE_COLORS = [
	'bg-primary/10 text-primary',
	'bg-chart-2/10 text-chart-2',
	'bg-chart-3/10 text-chart-3',
	'bg-chart-4/10 text-chart-4',
	'bg-chart-5/10 text-chart-5',
];

export function ContactBubble({ firstName, lastName, index }: ContactBubbleProps) {
	const initial = getContactInitial(firstName, lastName);
	const color = BUBBLE_COLORS[index % BUBBLE_COLORS.length];
	const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

	return (
		<div
			className="flex flex-col items-center gap-1"
			style={{
				animation: `bubble-in 0.4s ease-out ${index * 80}ms both`,
			}}
		>
			<div
				className={cn(
					'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold',
					color,
				)}
			>
				{initial}
			</div>
			<span className="max-w-[60px] truncate text-[10px] text-muted-foreground">{name}</span>
		</div>
	);
}
