'use client';

// Needs interactivity: popover state, search input, keyboard navigation

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Contact {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

interface ContactComboboxProps {
	contacts: Contact[];
	value: string;
	onSelect: (contactId: string) => void;
	placeholder?: string;
}

function contactName(c: Contact) {
	return [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
}

export function ContactCombobox({
	contacts,
	value,
	onSelect,
	placeholder = 'Select contact...',
}: ContactComboboxProps) {
	const [open, setOpen] = useState(false);
	const selected = contacts.find((c) => c.id === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						'flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
						!value && 'text-muted-foreground',
					)}
				>
					<span className="truncate">{selected ? contactName(selected) : placeholder}</span>
					<ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search contacts..." />
					<CommandList>
						<CommandEmpty>No contacts found.</CommandEmpty>
						<CommandGroup>
							{contacts.map((c) => (
								<CommandItem
									key={c.id}
									value={contactName(c)}
									onSelect={() => {
										onSelect(c.id === value ? '' : c.id);
										setOpen(false);
									}}
								>
									<CheckIcon
										className={cn('mr-2 h-4 w-4', value === c.id ? 'opacity-100' : 'opacity-0')}
									/>
									{contactName(c)}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
