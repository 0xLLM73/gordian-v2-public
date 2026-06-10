export {
	buildDealContextPack,
	buildDeterministicDealOutput,
	generateDealLocalAiOutput,
	getDealLocalAiStatus,
} from '@repo/shared';
export type {
	BuildDealContextInput,
	DealContextPack,
	DealLocalAiGeneratedOutput,
	DealLocalAiRunType,
	DealLocalAiStatus,
} from '@repo/shared';

import type { DealContextPack } from '@repo/shared';
import { generateDealLocalAiOutput } from '@repo/shared';

export function generateDealBriefLocal(
	context: DealContextPack,
	options?: Parameters<typeof generateDealLocalAiOutput>[2],
) {
	return generateDealLocalAiOutput(context, 'brief', options);
}

export function generateDealDraftFollowUp(
	context: DealContextPack,
	options?: Parameters<typeof generateDealLocalAiOutput>[2],
) {
	return generateDealLocalAiOutput(context, 'follow_up_draft', options);
}

export function generateDealRiskExplanation(
	context: DealContextPack,
	options?: Parameters<typeof generateDealLocalAiOutput>[2],
) {
	return generateDealLocalAiOutput(context, 'risk', options);
}

export function answerDealQuestion(
	context: DealContextPack,
	question: string,
	options?: Omit<Parameters<typeof generateDealLocalAiOutput>[2], 'question'>,
) {
	return generateDealLocalAiOutput(context, 'question_answer', { ...options, question });
}
