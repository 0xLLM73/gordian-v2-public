'use client';

import { createContactAction } from '@/app/actions/contacts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddContactButton() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
			>
				+ Add Contact
			</button>
			{isOpen ? <AddContactModal onClose={() => setIsOpen(false)} /> : null}
		</>
	);
}

function AddContactModal({ onClose }: { onClose: () => void }) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(e.currentTarget);
		const firstName = (form.get('firstName') as string)?.trim() || undefined;
		const lastName = (form.get('lastName') as string)?.trim() || undefined;
		const phone = (form.get('phone') as string)?.trim() || undefined;
		const email = (form.get('email') as string)?.trim() || undefined;
		const notes = (form.get('notes') as string)?.trim() || undefined;

		if (!firstName && !lastName) {
			setError('Please enter at least a first or last name.');
			setPending(false);
			return;
		}

		try {
			const result = await createContactAction({ firstName, lastName, phone, email, notes });
			if (result?.serverError) {
				setError(result.serverError);
			} else {
				router.refresh();
				onClose();
			}
		} catch {
			setError('Failed to create contact.');
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">Add Contact</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground"
					>
						&#10005;
					</button>
				</div>

				{error ? (
					<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
				) : null}

				<form onSubmit={handleSubmit} className="space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label htmlFor="firstName" className="mb-1 block text-xs font-medium text-foreground">
								First Name
							</label>
							<input
								id="firstName"
								name="firstName"
								type="text"
								className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
						<div>
							<label htmlFor="lastName" className="mb-1 block text-xs font-medium text-foreground">
								Last Name
							</label>
							<input
								id="lastName"
								name="lastName"
								type="text"
								className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
					</div>

					<div>
						<label htmlFor="phone" className="mb-1 block text-xs font-medium text-foreground">
							Phone
						</label>
						<input
							id="phone"
							name="phone"
							type="tel"
							placeholder="+1234567890"
							className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>

					<div>
						<label htmlFor="email" className="mb-1 block text-xs font-medium text-foreground">
							Email
						</label>
						<input
							id="email"
							name="email"
							type="email"
							className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>

					<div>
						<label htmlFor="notes" className="mb-1 block text-xs font-medium text-foreground">
							Notes
						</label>
						<textarea
							id="notes"
							name="notes"
							rows={2}
							className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={pending}
							className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
						>
							{pending ? 'Creating...' : 'Create Contact'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
