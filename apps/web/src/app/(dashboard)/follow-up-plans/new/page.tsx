import { redirect } from 'next/navigation';

type NewFollowUpPlanSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

export default async function NewFollowUpPlanPage({
	searchParams,
}: {
	searchParams: Promise<NewFollowUpPlanSearchParams>;
}) {
	const incoming = await searchParams;
	const params = new URLSearchParams({ new: '1' });
	const contactId = firstParam(incoming.contactId);
	const goalId = firstParam(incoming.goalId);

	if (contactId) params.set('contactId', contactId);
	if (goalId) params.set('goalId', goalId);

	redirect(`/follow-up-plans?${params.toString()}`);
}
