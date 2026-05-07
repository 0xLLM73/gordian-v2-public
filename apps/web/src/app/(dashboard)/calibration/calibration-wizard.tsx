'use client';

// Client boundary: multi-step wizard state, back/next navigation, chip selectors, submit on review step

import { saveCalibrationAction } from '@/app/actions/calibration';
import { type CalibrationInput, industryFocusOptions, priorityOptions } from '@repo/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const TOTAL_STEPS = 6;

const COMMUNICATION_STYLE_OPTIONS = [
	{ value: 'direct' as const, label: 'Direct', description: 'No fluff. Key points only.' },
	{
		value: 'formal' as const,
		label: 'Formal',
		description: 'Professional and structured.',
	},
	{
		value: 'diplomatic' as const,
		label: 'Diplomatic',
		description: 'Thoughtful, considerate of feelings.',
	},
	{
		value: 'casual' as const,
		label: 'Casual',
		description: 'Conversational and approachable.',
	},
];

const DETAIL_PREFERENCE_OPTIONS = [
	{
		value: 'high_level' as const,
		label: 'High level',
		description: 'Just the headline.',
	},
	{
		value: 'balanced' as const,
		label: 'Balanced',
		description: 'Enough context to decide.',
	},
	{
		value: 'granular' as const,
		label: 'Granular',
		description: 'Full picture before I act.',
	},
];

const RISK_TOLERANCE_OPTIONS = [
	{
		value: 'conservative' as const,
		label: 'Conservative',
		description: 'Preserve capital. Proven tracks.',
	},
	{
		value: 'moderate' as const,
		label: 'Moderate',
		description: 'Balanced risk/reward.',
	},
	{
		value: 'aggressive' as const,
		label: 'Aggressive',
		description: 'High conviction. High upside.',
	},
];

const DECISION_SPEED_OPTIONS = [
	{
		value: 'deliberate' as const,
		label: 'Deliberate',
		description: 'Careful analysis first.',
	},
	{
		value: 'moderate' as const,
		label: 'Moderate',
		description: 'Balance speed and diligence.',
	},
	{ value: 'fast' as const, label: 'Fast', description: 'Bias toward action.' },
];

const RELATIONSHIP_FOCUS_OPTIONS = [
	{
		value: 'breadth' as const,
		label: 'Breadth',
		description: 'Wide network. Maximise reach.',
	},
	{
		value: 'balanced' as const,
		label: 'Balanced',
		description: 'Mix of breadth and depth.',
	},
	{
		value: 'depth' as const,
		label: 'Depth',
		description: 'Few deep, high-trust relationships.',
	},
];

const INDUSTRY_LABELS: Record<string, string> = {
	defi: 'DeFi',
	infrastructure: 'Infrastructure',
	gaming: 'Gaming',
	ai: 'AI',
	social: 'Social',
	nft: 'NFT',
	dao: 'DAO',
	privacy: 'Privacy',
	payments: 'Payments',
	security: 'Security',
	data: 'Data',
	identity: 'Identity',
	rwa: 'RWA',
	other: 'Other',
};

const PRIORITY_LABELS: Record<string, string> = {
	deal_flow: 'Deal Flow',
	relationship_building: 'Relationship Building',
	market_intelligence: 'Market Intelligence',
	portfolio_support: 'Portfolio Support',
	networking: 'Networking',
};

interface WizardData {
	roleDescription: string;
	industryFocus: string[];
	communicationStyle?: CalibrationInput['communicationStyle'];
	detailPreference?: CalibrationInput['detailPreference'];
	riskTolerance?: CalibrationInput['riskTolerance'];
	decisionSpeed?: CalibrationInput['decisionSpeed'];
	relationshipFocus?: CalibrationInput['relationshipFocus'];
	priorities: string[];
	investmentThesis?: string;
	ticketSizeMin?: number;
	ticketSizeMax?: number;
}

interface InitialData {
	communicationStyle?: string | null;
	detailPreference?: string | null;
	riskTolerance?: string | null;
	decisionSpeed?: string | null;
	relationshipFocus?: string | null;
	priorities?: string[] | null;
	industryFocus?: string[] | null;
	roleDescription?: string | null;
	investmentThesis?: string | null;
	ticketSizeMin?: number | null;
	ticketSizeMax?: number | null;
}

export function CalibrationWizard({ initialData }: { initialData?: InitialData | null }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [step, setStep] = useState<Step>(1);
	const [error, setError] = useState<string | null>(null);

	const [data, setData] = useState<WizardData>({
		roleDescription: initialData?.roleDescription ?? '',
		industryFocus: initialData?.industryFocus ?? [],
		communicationStyle:
			(initialData?.communicationStyle as WizardData['communicationStyle']) ?? 'direct',
		detailPreference:
			(initialData?.detailPreference as WizardData['detailPreference']) ?? 'balanced',
		riskTolerance: (initialData?.riskTolerance as WizardData['riskTolerance']) ?? 'moderate',
		decisionSpeed: (initialData?.decisionSpeed as WizardData['decisionSpeed']) ?? 'moderate',
		relationshipFocus:
			(initialData?.relationshipFocus as WizardData['relationshipFocus']) ?? 'balanced',
		priorities: initialData?.priorities ?? [],
		investmentThesis: initialData?.investmentThesis ?? undefined,
		ticketSizeMin: initialData?.ticketSizeMin ?? undefined,
		ticketSizeMax: initialData?.ticketSizeMax ?? undefined,
	});

	function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
		setData((prev) => ({ ...prev, [key]: value }));
	}

	function toggleChip(field: 'industryFocus' | 'priorities', value: string, max: number) {
		setData((prev) => {
			const current = prev[field];
			if (current.includes(value)) {
				return { ...prev, [field]: current.filter((v) => v !== value) };
			}
			if (current.length >= max) return prev;
			return { ...prev, [field]: [...current, value] };
		});
	}

	function canAdvance(): boolean {
		if (step === 1) {
			return data.roleDescription.length >= 10 && data.industryFocus.length >= 1;
		}
		if (step === 4) {
			return data.priorities.length >= 1;
		}
		return true;
	}

	function handleSave() {
		setError(null);
		const {
			communicationStyle,
			detailPreference,
			riskTolerance,
			decisionSpeed,
			relationshipFocus,
		} = data;
		if (
			!communicationStyle ||
			!detailPreference ||
			!riskTolerance ||
			!decisionSpeed ||
			!relationshipFocus
		) {
			setError('Please complete all required fields.');
			return;
		}
		if (data.industryFocus.length === 0) {
			setError('Please select at least one industry focus.');
			return;
		}
		if (data.priorities.length === 0) {
			setError('Please select at least one priority.');
			return;
		}
		startTransition(async () => {
			try {
				const result = await saveCalibrationAction({
					communicationStyle,
					detailPreference,
					riskTolerance,
					decisionSpeed,
					relationshipFocus,
					priorities: data.priorities as CalibrationInput['priorities'],
					industryFocus: data.industryFocus as CalibrationInput['industryFocus'],
					roleDescription: data.roleDescription,
					investmentThesis: data.investmentThesis,
					ticketSizeMin: data.ticketSizeMin,
					ticketSizeMax: data.ticketSizeMax,
				});
				if (result?.serverError) {
					setError(result.serverError);
					toast.error(result.serverError);
					return;
				}
				if (result?.validationErrors) {
					setError('Please check your input and try again.');
					toast.error('Validation failed. Please check your input.');
					return;
				}
				if (!result?.data) {
					setError('Failed to save calibration. Please try again.');
					toast.error('Failed to save calibration.');
					return;
				}
				toast.success('Calibration saved');
				router.push('/settings');
			} catch {
				setError('An unexpected error occurred. Please try again.');
				toast.error('An unexpected error occurred.');
			}
		});
	}

	return (
		<div className="mx-auto max-w-2xl">
			{/* Progress bar */}
			<div className="mb-8">
				<div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
					<span>
						Step {step} of {TOTAL_STEPS}
					</span>
					<span>{Math.round((step / TOTAL_STEPS) * 100)}% complete</span>
				</div>
				<div className="h-2 w-full rounded-full bg-muted">
					<div
						className="h-2 rounded-full bg-indigo-600 transition-all duration-300"
						style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
					/>
				</div>
			</div>

			{/* Step content */}
			<div className="rounded-lg border border-border bg-card p-8">
				{step === 1 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">Role & Focus</h2>

						<div className="mb-6">
							<label
								htmlFor="roleDescription"
								className="mb-1 block text-sm font-medium text-foreground"
							>
								Describe your role{' '}
								<span className="font-normal text-muted-foreground">(10–500 chars, required)</span>
							</label>
							<textarea
								id="roleDescription"
								rows={3}
								maxLength={500}
								value={data.roleDescription}
								onChange={(e) => update('roleDescription', e.target.value)}
								placeholder="e.g. Early-stage crypto investor focused on DeFi and infrastructure protocols"
								className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
							/>
							{data.roleDescription.length > 0 && data.roleDescription.length < 10 ? (
								<p className="mt-1 text-xs text-red-500">At least 10 characters required</p>
							) : null}
						</div>

						<div>
							<p className="mb-3 text-sm font-medium text-foreground">
								Industry focus{' '}
								<span className="font-normal text-muted-foreground">(select 1–5, required)</span>
							</p>
							<div className="flex flex-wrap gap-2">
								{industryFocusOptions.map((opt) => (
									<button
										key={opt}
										type="button"
										onClick={() => toggleChip('industryFocus', opt, 5)}
										className={`rounded-full border px-3 py-1 text-sm transition-colors ${
											data.industryFocus.includes(opt)
												? 'border-indigo-500 bg-indigo-50 text-indigo-700'
												: 'border-border text-foreground hover:border-border'
										}`}
									>
										{INDUSTRY_LABELS[opt] ?? opt}
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				{step === 2 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">Communication Style</h2>

						<div className="mb-6">
							<p className="mb-3 text-sm font-medium text-foreground">
								How do you prefer to communicate?
							</p>
							<RadioCards
								options={COMMUNICATION_STYLE_OPTIONS}
								selected={data.communicationStyle}
								onSelect={(v) =>
									update('communicationStyle', v as WizardData['communicationStyle'])
								}
							/>
						</div>

						<div>
							<p className="mb-3 text-sm font-medium text-foreground">
								How much context do you need?
							</p>
							<RadioCards
								options={DETAIL_PREFERENCE_OPTIONS}
								selected={data.detailPreference}
								onSelect={(v) => update('detailPreference', v as WizardData['detailPreference'])}
							/>
						</div>
					</div>
				)}

				{step === 3 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">Decision Making</h2>

						<div className="mb-6">
							<p className="mb-3 text-sm font-medium text-foreground">
								What's your investment posture?
							</p>
							<RadioCards
								options={RISK_TOLERANCE_OPTIONS}
								selected={data.riskTolerance}
								onSelect={(v) => update('riskTolerance', v as WizardData['riskTolerance'])}
							/>
						</div>

						<div>
							<p className="mb-3 text-sm font-medium text-foreground">
								How fast do you make decisions?
							</p>
							<RadioCards
								options={DECISION_SPEED_OPTIONS}
								selected={data.decisionSpeed}
								onSelect={(v) => update('decisionSpeed', v as WizardData['decisionSpeed'])}
							/>
						</div>
					</div>
				)}

				{step === 4 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">Relationship Strategy</h2>

						<div className="mb-6">
							<p className="mb-3 text-sm font-medium text-foreground">
								What drives your relationships?
							</p>
							<RadioCards
								options={RELATIONSHIP_FOCUS_OPTIONS}
								selected={data.relationshipFocus}
								onSelect={(v) => update('relationshipFocus', v as WizardData['relationshipFocus'])}
							/>
						</div>

						<div>
							<p className="mb-3 text-sm font-medium text-foreground">
								Top priorities{' '}
								<span className="font-normal text-muted-foreground">(select 1–3, required)</span>
							</p>
							<div className="flex flex-wrap gap-2">
								{priorityOptions.map((opt) => (
									<button
										key={opt}
										type="button"
										onClick={() => toggleChip('priorities', opt, 3)}
										className={`rounded-full border px-3 py-1 text-sm transition-colors ${
											data.priorities.includes(opt)
												? 'border-indigo-500 bg-indigo-50 text-indigo-700'
												: 'border-border text-foreground hover:border-border'
										}`}
									>
										{PRIORITY_LABELS[opt] ?? opt}
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				{step === 5 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">
							Investment Profile{' '}
							<span className="text-sm font-normal text-muted-foreground">(optional)</span>
						</h2>

						<div className="mb-4">
							<label
								htmlFor="investmentThesis"
								className="mb-1 block text-sm font-medium text-foreground"
							>
								Investment thesis
							</label>
							<textarea
								id="investmentThesis"
								rows={3}
								maxLength={1000}
								value={data.investmentThesis ?? ''}
								onChange={(e) => update('investmentThesis', e.target.value || undefined)}
								placeholder="e.g. Focused on L1/L2 infrastructure with 3–5 year horizons"
								className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<label
									htmlFor="ticketSizeMin"
									className="mb-1 block text-sm font-medium text-foreground"
								>
									Min ticket size ($)
								</label>
								<input
									id="ticketSizeMin"
									type="number"
									min={1}
									value={data.ticketSizeMin ?? ''}
									onChange={(e) =>
										update('ticketSizeMin', e.target.value ? Number(e.target.value) : undefined)
									}
									placeholder="e.g. 25000"
									className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
								/>
							</div>
							<div>
								<label
									htmlFor="ticketSizeMax"
									className="mb-1 block text-sm font-medium text-foreground"
								>
									Max ticket size ($)
								</label>
								<input
									id="ticketSizeMax"
									type="number"
									min={1}
									value={data.ticketSizeMax ?? ''}
									onChange={(e) =>
										update('ticketSizeMax', e.target.value ? Number(e.target.value) : undefined)
									}
									placeholder="e.g. 500000"
									className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
								/>
							</div>
						</div>
					</div>
				)}

				{step === 6 && (
					<div>
						<h2 className="mb-6 text-xl font-semibold text-foreground">Review & Confirm</h2>
						<dl className="space-y-3 text-sm">
							<ReviewRow label="Role" value={data.roleDescription} />
							<ReviewRow
								label="Industry focus"
								value={data.industryFocus.map((v) => INDUSTRY_LABELS[v] ?? v).join(', ')}
							/>
							<ReviewRow label="Communication style" value={data.communicationStyle} />
							<ReviewRow label="Detail preference" value={data.detailPreference} />
							<ReviewRow label="Risk tolerance" value={data.riskTolerance} />
							<ReviewRow label="Decision speed" value={data.decisionSpeed} />
							<ReviewRow label="Relationship focus" value={data.relationshipFocus} />
							<ReviewRow
								label="Priorities"
								value={data.priorities.map((v) => PRIORITY_LABELS[v] ?? v).join(', ')}
							/>
							{data.investmentThesis ? (
								<ReviewRow label="Investment thesis" value={data.investmentThesis} />
							) : null}
							{data.ticketSizeMin || data.ticketSizeMax ? (
								<ReviewRow
									label="Ticket size"
									value={[
										data.ticketSizeMin ? `$${data.ticketSizeMin.toLocaleString()}` : null,
										data.ticketSizeMax ? `$${data.ticketSizeMax.toLocaleString()}` : null,
									]
										.filter(Boolean)
										.join(' – ')}
								/>
							) : null}
						</dl>
					</div>
				)}

				{error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
			</div>

			{/* Navigation */}
			<div className="mt-6 flex items-center justify-between">
				{step > 1 ? (
					<button
						type="button"
						onClick={() => setStep((s) => (s - 1) as Step)}
						className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
					>
						Back
					</button>
				) : (
					<div />
				)}

				<div className="flex items-center gap-3">
					{step === 5 && (
						<button
							type="button"
							onClick={() => setStep(6)}
							className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
						>
							Skip
						</button>
					)}

					{step < TOTAL_STEPS ? (
						<button
							type="button"
							onClick={() => {
								if (!canAdvance()) return;
								setStep((s) => (s + 1) as Step);
							}}
							disabled={!canAdvance()}
							className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Next
						</button>
					) : (
						<button
							type="button"
							onClick={handleSave}
							disabled={isPending}
							className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
						>
							{isPending ? 'Saving…' : 'Save Calibration'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/* ─── Radio card grid ──────────────────────────────────────────────────────── */

interface RadioOption {
	value: string;
	label: string;
	description: string;
}

function RadioCards({
	options,
	selected,
	onSelect,
}: {
	options: RadioOption[];
	selected?: string;
	onSelect: (value: string) => void;
}) {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => onSelect(opt.value)}
					className={`rounded-lg border p-4 text-left transition-colors ${
						selected === opt.value
							? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
							: 'border-border hover:border-border'
					}`}
				>
					<p className="font-medium text-foreground">{opt.label}</p>
					<p className="mt-1 text-sm text-muted-foreground">{opt.description}</p>
				</button>
			))}
		</div>
	);
}

/* ─── Review row ───────────────────────────────────────────────────────────── */

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
	if (!value) return null;
	return (
		<div className="flex gap-4">
			<dt className="w-40 shrink-0 font-medium text-muted-foreground">{label}</dt>
			<dd className="text-foreground">{value}</dd>
		</div>
	);
}
