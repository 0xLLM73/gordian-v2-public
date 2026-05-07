'use client';
// 'use client' — needs useState/useEffect for wizard steps + useAction for server action calls

import { listContactsAction } from '@/app/actions/contacts';
import {
	activateFollowUpPlanAction,
	createFollowUpPlanAction,
	getFollowUpPlanTemplatesAction,
} from '@/app/actions/follow-up-plans';
import { useAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Template {
	id: string;
	title: string;
	description: string;
	steps: Array<{ prompt: string; delayHours: number }>;
}

interface Contact {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

export function FollowUpPlanWizardButton() {
	const [isOpen, setIsOpen] = useState(false);

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
			>
				+ New Follow-up Plan
			</button>
		);
	}

	return <FollowUpPlanWizard onClose={() => setIsOpen(false)} />;
}

function FollowUpPlanWizard({ onClose }: { onClose: () => void }) {
	const router = useRouter();
	const [step, setStep] = useState<'template' | 'configure' | 'creating'>('template');
	const [templates, setTemplates] = useState<Template[]>([]);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
	const [contactId, setContactId] = useState('');
	const [title, setTitle] = useState('');
	const [pending, setPending] = useState(false);
	const [templateError, setTemplateError] = useState(false);

	const { execute: loadContacts } = useAction(listContactsAction, {
		onSuccess: (result) => {
			if (result.data) {
				setContacts(
					result.data.map((c: Record<string, unknown>) => ({
						id: c.id as string,
						firstName: (c.firstName as string) || null,
						lastName: (c.lastName as string) || null,
					})),
				);
			}
		},
	});

	useEffect(() => {
		getFollowUpPlanTemplatesAction({})
			.then((result) => {
				if (result?.data) {
					setTemplates(result.data as Template[]);
				}
			})
			.catch(() => setTemplateError(true));
		loadContacts({ limit: 100 });
	}, [loadContacts]);

	function selectTemplate(t: Template) {
		setSelectedTemplate(t);
		setTitle(t.title);
		setStep('configure');
	}

	async function handleCreate() {
		if (!contactId.trim() || !selectedTemplate) return;
		setPending(true);
		setStep('creating');

		try {
			const result = await createFollowUpPlanAction({
				contactId: contactId.trim(),
				title,
				templateId: selectedTemplate.id,
				steps: selectedTemplate.steps,
			});

			if (result?.data?.id) {
				await activateFollowUpPlanAction({ followUpPlanId: result.data.id });
			}

			router.refresh();
			onClose();
		} catch {
			setPending(false);
			setStep('configure');
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg bg-card p-6 shadow-xl">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">
						{step === 'template'
							? 'Choose Template'
							: step === 'configure'
								? 'Configure Follow-up Plan'
								: 'Creating...'}
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground"
					>
						{'×'}
					</button>
				</div>

				{step === 'template' ? (
					<div className="space-y-3">
						{templateError ? (
							<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
								<p className="text-sm text-red-700">Failed to load templates.</p>
								<button
									type="button"
									onClick={() => {
										setTemplateError(false);
										getFollowUpPlanTemplatesAction({})
											.then((result) => {
												if (result?.data) setTemplates(result.data as Template[]);
											})
											.catch(() => setTemplateError(true));
									}}
									className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-800"
								>
									Retry
								</button>
							</div>
						) : null}
						{templates.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => selectTemplate(t)}
								className="w-full rounded-lg border border-border p-4 text-left hover:border-blue-300 hover:bg-blue-50"
							>
								<p className="font-medium text-foreground">{t.title}</p>
								<p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
								<p className="mt-1 text-xs text-muted-foreground">{t.steps.length} steps</p>
							</button>
						))}
					</div>
				) : step === 'configure' ? (
					<div className="space-y-4">
						<div>
							<label htmlFor="cw-title" className="block text-sm font-medium text-foreground">
								Title
							</label>
							<input
								id="cw-title"
								type="text"
								value={title}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
								className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
							/>
						</div>
						<div>
							<label htmlFor="cw-contact" className="block text-sm font-medium text-foreground">
								Contact
							</label>
							<select
								id="cw-contact"
								value={contactId}
								onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setContactId(e.target.value)}
								className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
							>
								<option value="">Select contact...</option>
								{contacts.map((c) => (
									<option key={c.id} value={c.id}>
										{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'}
									</option>
								))}
							</select>
						</div>
						{selectedTemplate ? (
							<div>
								<p className="text-sm font-medium text-foreground">Steps</p>
								<ol className="mt-2 space-y-2">
									{selectedTemplate.steps.map((s, i) => (
										<li key={s.prompt} className="text-sm text-muted-foreground">
											<span className="font-medium text-gray-800">{i + 1}.</span> {s.prompt}
											<span className="ml-1 text-xs text-muted-foreground">
												({s.delayHours}h delay)
											</span>
										</li>
									))}
								</ol>
							</div>
						) : null}
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setStep('template')}
								className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
							>
								Back
							</button>
							<button
								type="button"
								onClick={handleCreate}
								disabled={pending || !contactId.trim()}
								className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
							>
								Create & Activate
							</button>
						</div>
					</div>
				) : (
					<div className="py-8 text-center text-sm text-muted-foreground">
						Creating follow-up plan...
					</div>
				)}
			</div>
		</div>
	);
}
