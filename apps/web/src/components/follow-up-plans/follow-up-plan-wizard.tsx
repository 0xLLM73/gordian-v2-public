'use client';

// 'use client' — needs useState/useEffect for wizard steps + useAction for server action calls

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { useEffect, useState } from 'react';
import { listContactsAction } from '@/app/actions/contacts';
import {
	activateFollowUpPlanAction,
	createFollowUpPlanAction,
	createFollowUpPlanTemplateAction,
	createFollowUpPlanTemplateVersionAction,
	getFollowUpPlanTemplatesAction,
} from '@/app/actions/follow-up-plans';
import type {
	FollowUpPlanReadiness,
	FollowUpPlanReadinessTone,
} from '@/lib/follow-up-plans-readiness-types';

interface Template {
	id: string;
	title: string;
	description: string;
	version: number;
	source: 'built_in' | 'user';
	category?: string | null;
	steps: Array<{ prompt: string; delayHours: number }>;
}

interface Contact {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

interface DraftStep {
	id: string;
	prompt: string;
	delayHours: number;
}

let draftStepCounter = 0;

function createDraftStep(step: { prompt: string; delayHours: number }): DraftStep {
	draftStepCounter += 1;
	return {
		id: `draft-step-${draftStepCounter}`,
		prompt: step.prompt,
		delayHours: step.delayHours,
	};
}

function serializeDraftSteps(steps: DraftStep[]) {
	return steps
		.filter((s) => s.prompt.trim())
		.map((s) => ({ prompt: s.prompt, delayHours: s.delayHours }));
}

function goalObjective(goalTitle?: string) {
	const trimmedTitle = goalTitle?.trim();
	return trimmedTitle ? `Support goal: ${trimmedTitle}` : '';
}

export function FollowUpPlanWizardButton({
	initialContactId,
	initialGoalId,
	initialGoalTitle,
	openOnMount = false,
	readiness,
}: {
	initialContactId?: string;
	initialGoalId?: string;
	initialGoalTitle?: string;
	openOnMount?: boolean;
	readiness: FollowUpPlanReadiness | null;
}) {
	const [isOpen, setIsOpen] = useState(openOnMount);

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

	return (
		<FollowUpPlanWizard
			initialContactId={initialContactId}
			initialGoalId={initialGoalId}
			initialGoalTitle={initialGoalTitle}
			onClose={() => setIsOpen(false)}
			readiness={readiness}
		/>
	);
}

function FollowUpPlanWizard({
	initialContactId,
	initialGoalId,
	initialGoalTitle,
	onClose,
	readiness,
}: {
	initialContactId?: string;
	initialGoalId?: string;
	initialGoalTitle?: string;
	onClose: () => void;
	readiness: FollowUpPlanReadiness | null;
}) {
	const router = useRouter();
	const [step, setStep] = useState<'template' | 'configure' | 'creating'>('template');
	const [templates, setTemplates] = useState<Template[]>([]);
	const [contacts, setContacts] = useState<Contact[]>([]);
	const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
	const [planSteps, setPlanSteps] = useState<DraftStep[]>([]);
	const [contactId, setContactId] = useState('');
	const [title, setTitle] = useState('');
	const [objective, setObjective] = useState('');
	const [tone, setTone] = useState('Warm');
	const [aiMode, setAiMode] = useState<'local_ai' | 'template_only' | 'reminder_only'>('local_ai');
	const [sendingMode, setSendingMode] = useState<'manual' | 'reminder_only'>('manual');
	const [pending, setPending] = useState(false);
	const [savingTemplate, setSavingTemplate] = useState(false);
	const [templateSaveMessage, setTemplateSaveMessage] = useState<string | null>(null);
	const [templateError, setTemplateError] = useState(false);

	const { execute: loadContacts } = useAction(listContactsAction, {
		onSuccess: (result) => {
			if (result.data) {
				const nextContacts = result.data.map((c: Record<string, unknown>) => ({
					id: c.id as string,
					firstName: (c.firstName as string) || null,
					lastName: (c.lastName as string) || null,
				}));
				setContacts(nextContacts);
				if (initialContactId && nextContacts.some((c) => c.id === initialContactId)) {
					setContactId(initialContactId);
				}
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
		setObjective((current) => (current.trim() ? current : goalObjective(initialGoalTitle)));
		setPlanSteps(t.steps.map(createDraftStep));
		setTemplateSaveMessage(null);
		setStep('configure');
	}

	async function handleCreate(activateAfterCreate: boolean) {
		const validSteps = serializeDraftSteps(planSteps);
		if (!contactId.trim() || !selectedTemplate || validSteps.length === 0) return;
		setPending(true);
		setStep('creating');

		try {
			const result = await createFollowUpPlanAction({
				contactId: contactId.trim(),
				title,
				templateId: selectedTemplate.id,
				templateVersion: selectedTemplate.version,
				templateSource: selectedTemplate.source,
				config: {
					objective: objective.trim() || undefined,
					tone,
					channel: 'Telegram',
					aiMode,
					sendingMode,
					...(initialGoalId ? { sourceGoalId: initialGoalId } : {}),
				},
				steps: validSteps,
			});

			if (activateAfterCreate && result?.data?.id) {
				await activateFollowUpPlanAction({ followUpPlanId: result.data.id });
			}

			router.refresh();
			onClose();
		} catch {
			setPending(false);
			setStep('configure');
		}
	}

	async function handleSaveTemplateCopy() {
		if (!selectedTemplate || savingTemplate) return;
		const validSteps = serializeDraftSteps(planSteps);
		if (!title.trim() || validSteps.length === 0) {
			setTemplateSaveMessage('Add a title and at least one step before saving a local template.');
			return;
		}

		setSavingTemplate(true);
		setTemplateSaveMessage(null);
		try {
			const templateInput = {
				title: title.trim(),
				description: selectedTemplate.description,
				category: selectedTemplate.category ?? undefined,
				steps: validSteps,
			};
			const result =
				selectedTemplate.source === 'user'
					? await createFollowUpPlanTemplateVersionAction({
							templateId: selectedTemplate.id,
							...templateInput,
						})
					: await createFollowUpPlanTemplateAction(templateInput);
			if (result?.data) {
				const savedTemplate = result.data as Template;
				setTemplates((current) => [
					savedTemplate,
					...current.filter(
						(template) => !(template.source === 'user' && template.id === savedTemplate.id),
					),
				]);
				setSelectedTemplate(savedTemplate);
				setPlanSteps(savedTemplate.steps.map(createDraftStep));
				setTemplateSaveMessage(
					savedTemplate.version > 1
						? `Saved as local template v${savedTemplate.version}.`
						: 'Saved as a local template copy.',
				);
			}
		} catch {
			setTemplateSaveMessage('Could not save the local template copy.');
		} finally {
			setSavingTemplate(false);
		}
	}

	function updateStep(index: number, patch: Partial<Omit<DraftStep, 'id'>>) {
		setPlanSteps((current) =>
			current.map((stepConfig, i) => (i === index ? { ...stepConfig, ...patch } : stepConfig)),
		);
	}

	function addStep() {
		setPlanSteps((current) => [...current, createDraftStep({ prompt: '', delayHours: 24 })]);
	}

	function removeStep(index: number) {
		setPlanSteps((current) => current.filter((_, i) => i !== index));
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-6">
			<dialog
				aria-labelledby="follow-up-plan-wizard-title"
				aria-modal="true"
				className="my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border-0 bg-card p-0 text-card-foreground shadow-xl"
				open
			>
				<div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
					<h2 id="follow-up-plan-wizard-title" className="text-lg font-semibold text-foreground">
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

				<div className="min-h-0 overflow-y-auto px-6 pb-6">
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
									<p className="mt-1 text-xs text-muted-foreground">
										{t.category ? `${t.category} · ` : ''}
										{t.source === 'user' ? 'Local' : 'Built-in'} v{t.version} · {t.steps.length}{' '}
										steps
									</p>
								</button>
							))}
						</div>
					) : step === 'configure' ? (
						<div className="space-y-4">
							{initialGoalTitle ? (
								<div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
									<span className="font-medium">Linked goal:</span> {initialGoalTitle}
								</div>
							) : null}
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
									onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
										setContactId(e.target.value)
									}
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
							<div>
								<label htmlFor="cw-objective" className="block text-sm font-medium text-foreground">
									Objective
								</label>
								<textarea
									id="cw-objective"
									value={objective}
									onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
										setObjective(e.target.value)
									}
									className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
									rows={3}
									placeholder="What outcome should these follow-ups help with?"
								/>
							</div>
							<div className="grid gap-3 sm:grid-cols-3">
								<div>
									<label htmlFor="cw-tone" className="block text-sm font-medium text-foreground">
										Tone
									</label>
									<select
										id="cw-tone"
										value={tone}
										onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTone(e.target.value)}
										className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
									>
										<option value="Warm">Warm</option>
										<option value="Direct">Direct</option>
										<option value="Professional">Professional</option>
										<option value="Casual">Casual</option>
									</select>
								</div>
								<div>
									<label htmlFor="cw-ai-mode" className="block text-sm font-medium text-foreground">
										Draft mode
									</label>
									<select
										id="cw-ai-mode"
										value={aiMode}
										onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
											setAiMode(e.target.value as typeof aiMode)
										}
										className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
									>
										<option value="local_ai">Local AI</option>
										<option value="template_only">Template only</option>
										<option value="reminder_only">Reminder only</option>
									</select>
								</div>
								<div>
									<label
										htmlFor="cw-sending-mode"
										className="block text-sm font-medium text-foreground"
									>
										Sending
									</label>
									<select
										id="cw-sending-mode"
										value={sendingMode}
										onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
											setSendingMode(e.target.value as typeof sendingMode)
										}
										className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
									>
										<option value="manual">Manual</option>
										<option value="reminder_only">Reminder only</option>
									</select>
								</div>
							</div>
							{selectedTemplate ? (
								<div>
									<div className="flex items-center justify-between gap-3">
										<p className="text-sm font-medium text-foreground">Steps</p>
										<button
											type="button"
											onClick={addStep}
											className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
										>
											Add step
										</button>
									</div>
									<div className="mt-2 space-y-3">
										{planSteps.map((s, i) => (
											<div key={s.id} className="rounded-md border border-border p-3">
												<div className="flex items-center justify-between gap-3">
													<p className="text-xs font-medium text-muted-foreground">Step {i + 1}</p>
													{planSteps.length > 1 ? (
														<button
															type="button"
															onClick={() => removeStep(i)}
															className="text-xs font-medium text-red-600 hover:underline"
														>
															Remove
														</button>
													) : null}
												</div>
												<label
													htmlFor={`cw-step-${i}-prompt`}
													className="mt-2 block text-xs font-medium text-foreground"
												>
													Prompt
												</label>
												<textarea
													id={`cw-step-${i}-prompt`}
													aria-label={`Step ${i + 1} prompt`}
													value={s.prompt}
													onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
														updateStep(i, { prompt: e.target.value })
													}
													className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
													rows={2}
												/>
												<label
													htmlFor={`cw-step-${i}-delay`}
													className="mt-2 block text-xs font-medium text-foreground"
												>
													Delay hours
												</label>
												<input
													id={`cw-step-${i}-delay`}
													aria-label={`Step ${i + 1} delay hours`}
													type="number"
													min={0}
													value={s.delayHours}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
														updateStep(i, {
															delayHours: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
														})
													}
													className="mt-1 w-28 rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
												/>
											</div>
										))}
									</div>
								</div>
							) : null}
							{templateSaveMessage ? (
								<p className="text-xs text-muted-foreground">{templateSaveMessage}</p>
							) : null}
							{readiness ? <WizardReadinessChecklist readiness={readiness} /> : null}
							<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
								Drafts are generated locally for review. Nothing is sent automatically; manual
								confirmation is required before a step advances.
							</div>
							<div className="flex flex-wrap justify-end gap-2">
								<button
									type="button"
									onClick={() => setStep('template')}
									className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
								>
									Back
								</button>
								<button
									type="button"
									onClick={() => handleCreate(false)}
									disabled={pending || !contactId.trim() || planSteps.length === 0}
									className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
								>
									Save draft
								</button>
								<button
									type="button"
									onClick={handleSaveTemplateCopy}
									disabled={pending || savingTemplate || planSteps.length === 0}
									className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
								>
									{savingTemplate
										? 'Saving...'
										: selectedTemplate?.source === 'user'
											? 'Save new version'
											: 'Save as local template'}
								</button>
								<button
									type="button"
									onClick={() => handleCreate(true)}
									disabled={pending || !contactId.trim() || planSteps.length === 0}
									className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
								>
									Create & activate
								</button>
							</div>
						</div>
					) : (
						<div className="py-8 text-center text-sm text-muted-foreground">
							Creating follow-up plan...
						</div>
					)}
				</div>
			</dialog>
		</div>
	);
}

function readinessClass(status: FollowUpPlanReadinessTone) {
	if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
	if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
	if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-900';
	return 'border-slate-200 bg-slate-50 text-slate-800';
}

function WizardReadinessChecklist({ readiness }: { readiness: FollowUpPlanReadiness }) {
	const items = [readiness.localAi, readiness.telegram, readiness.notifications];
	return (
		<div>
			<p className="text-sm font-medium text-foreground">Readiness</p>
			<div className="mt-2 grid gap-2">
				{items.map((item) => (
					<div
						key={item.label}
						className={`rounded-md border px-3 py-2 ${readinessClass(item.status)}`}
					>
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm font-medium">{item.label}</p>
							<span className="text-xs font-medium">{item.value}</span>
						</div>
						<p className="mt-1 text-xs">{item.detail}</p>
					</div>
				))}
			</div>
		</div>
	);
}
