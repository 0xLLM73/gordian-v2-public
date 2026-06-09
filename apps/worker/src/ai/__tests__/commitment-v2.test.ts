import { describe, expect, it } from 'vitest';
import type { ExtractedCommitment } from '../commitment-extraction';
import {
	analyzeCommitmentV2Shadow,
	buildCommitmentV2Candidates,
	filterCommitmentsByV2Validation,
	validateCommitmentV2Item,
} from '../commitment-v2';

const MSG_1 = '11111111-1111-4111-8111-111111111111';
const MSG_2 = '22222222-2222-4222-8222-222222222222';
const MSG_3 = '33333333-3333-4333-8333-333333333333';

function commitment(overrides: Partial<ExtractedCommitment> = {}): ExtractedCommitment {
	return {
		title: 'Send the deck by Friday',
		commitment_type: 'task',
		assignee: 'user',
		due_date: undefined,
		due_date_text: 'Friday',
		due_precision: 'relative',
		confidence: 0.84,
		quote: "I'll send the deck by Friday",
		source_message_ids: [MSG_1],
		evidence_level: 'explicit',
		state: 'open',
		rationale_tags: ['explicit_promise'],
		failure_reason: undefined,
		...overrides,
	};
}

describe('commitment v2 shadow pipeline', () => {
	it('builds candidate windows with reason codes and no raw text', () => {
		const candidates = buildCommitmentV2Candidates(
			[
				{
					id: MSG_1,
					sourceMessageId: MSG_1,
					role: 'user',
					content: "I'll send the deck by Friday",
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			Buffer.from('workspace-salt'),
		);

		expect(candidates).toEqual([
			expect.objectContaining({
				anchorSourceId: MSG_1,
				windowSourceIds: [MSG_1],
				positiveReasonCodes: expect.arrayContaining([
					'first_person_promise',
					'date_or_deadline',
					'trackable_action_verb',
				]),
				negativeReasonCodes: [],
				contentFingerprintHmac: expect.any(String),
			}),
		]);
		expect(JSON.stringify(candidates)).not.toContain('deck');
	});

	it('routes strongly grounded commitments to draft while active autocreate is disabled', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: "I'll send the deck by Friday",
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const candidates = buildCommitmentV2Candidates(messages);

		const item = validateCommitmentV2Item({
			commitment: commitment({ confidence: 0.96 }),
			messages,
			candidates,
			activeAutocreateEnabled: false,
		});

		expect(item.route).toBe('draft');
		expect(item.failureCodes).toEqual([]);
		expect(item.warningCodes).toEqual([]);
	});

	it('allows active route only for exact high-confidence explicit evidence when enabled', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: "I'll send the deck by Friday",
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const candidates = buildCommitmentV2Candidates(messages);

		const item = validateCommitmentV2Item({
			commitment: commitment({ confidence: 0.96 }),
			messages,
			candidates,
			activeAutocreateEnabled: true,
		});

		expect(item.route).toBe('active');
	});

	it('rejects attendance and banter even when the model produced a commitment', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: "I'll be there haha",
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const item = validateCommitmentV2Item({
			commitment: commitment({
				title: 'Attend the event',
				commitment_type: 'meeting',
				quote: "I'll be there haha",
				confidence: 0.93,
			}),
			messages,
			candidates: buildCommitmentV2Candidates(messages),
			activeAutocreateEnabled: true,
		});

		expect(item.route).toBe('reject');
		expect(item.failureCodes).toEqual(
			expect.arrayContaining(['attendance_confirmation', 'banter_or_threat']),
		);
	});

	it('rejects abusive first-person statements without a trackable action', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: 'I will humble him and make him feel less than a human.',
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const item = validateCommitmentV2Item({
			commitment: commitment({
				title: 'Humble him',
				quote: 'I will humble him and make him feel less than a human.',
				confidence: 0.9,
			}),
			messages,
			candidates: buildCommitmentV2Candidates(messages),
		});

		expect(item.route).toBe('reject');
		expect(item.failureCodes).toEqual(
			expect.arrayContaining(['not_trackable', 'banter_or_threat']),
		);
	});

	it('rejects generic future announcements as non-actionable CRM commitments', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: 'I will be sending out another announcement two weeks before the event starts.',
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const item = validateCommitmentV2Item({
			commitment: commitment({
				title: 'Send another announcement before the event',
				quote: 'I will be sending out another announcement two weeks before the event starts.',
				confidence: 0.88,
			}),
			messages,
			candidates: buildCommitmentV2Candidates(messages),
		});

		expect(item.route).toBe('reject');
		expect(item.failureCodes).toContain('announcement');
	});

	it('filters rejected model outputs before storage', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'user',
				content: "I'll send the deck by Friday",
				timestamp: '2026-01-01T00:00:00Z',
			},
			{
				id: MSG_2,
				sourceMessageId: MSG_2,
				role: 'user',
				content: "I'll be there haha",
				timestamp: '2026-01-01T00:01:00Z',
			},
		];
		const result = filterCommitmentsByV2Validation({
			messages,
			extractedCommitments: [
				commitment({
					title: 'Send the deck by Friday',
					quote: "I'll send the deck by Friday",
					source_message_ids: [MSG_1],
				}),
				commitment({
					title: 'Attend the event',
					commitment_type: 'meeting',
					quote: "I'll be there haha",
					source_message_ids: [MSG_2],
					confidence: 0.93,
				}),
			],
		});

		expect(result.commitments).toHaveLength(1);
		expect(result.report.routeCounts).toEqual(
			expect.objectContaining({
				draft: 1,
				reject: 1,
			}),
		);
	});

	it('keeps accepted requests tied to both source messages', () => {
		const messages = [
			{
				id: MSG_1,
				sourceMessageId: MSG_1,
				role: 'assistant',
				content: 'Can you send the deck before tomorrow?',
				timestamp: '2026-01-01T00:00:00Z',
			},
			{
				id: MSG_2,
				sourceMessageId: MSG_2,
				role: 'user',
				content: 'Sure, on it',
				timestamp: '2026-01-01T00:01:00Z',
			},
		];
		const report = analyzeCommitmentV2Shadow({
			messages,
			extractedCommitments: [
				commitment({
					title: 'Send the deck before tomorrow',
					confidence: 0.8,
					quote: 'Sure, on it',
					source_message_ids: [MSG_1, MSG_2],
					evidence_level: 'accepted_request',
				}),
			],
		});

		expect(report.candidateCount).toBeGreaterThan(0);
		expect(report.validatedItems[0]).toEqual(
			expect.objectContaining({
				route: 'draft',
				sourceMessageIds: [MSG_1, MSG_2],
			}),
		);
	});

	it('rejects invented source ids and quote mismatches', () => {
		const messages = [
			{
				id: MSG_3,
				sourceMessageId: MSG_3,
				role: 'user',
				content: "I'll send the deck by Friday",
				timestamp: '2026-01-01T00:00:00Z',
			},
		];
		const item = validateCommitmentV2Item({
			commitment: commitment({
				source_message_ids: ['99999999-9999-4999-8999-999999999999'],
				quote: 'not in the transcript',
			}),
			messages,
			candidates: buildCommitmentV2Candidates(messages),
		});

		expect(item.route).toBe('reject');
		expect(item.failureCodes).toEqual(
			expect.arrayContaining(['source_id_not_in_episode', 'quote_not_grounded']),
		);
	});

	it('produces privacy-safe aggregate shadow telemetry', () => {
		const report = analyzeCommitmentV2Shadow({
			messages: [
				{
					id: MSG_1,
					sourceMessageId: MSG_1,
					role: 'user',
					content: "I'll send the passport scan by Friday",
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			extractedCommitments: [
				commitment({
					title: 'Send the passport scan by Friday',
					quote: "I'll send the passport scan by Friday",
				}),
			],
			workspaceSalt: Buffer.from('workspace-salt'),
			sourceAccountId: 'telegram-account-1',
		});

		expect(report.privacySafeEvent).toEqual(
			expect.objectContaining({
				event: 'commitment_v2_shadow_completed',
				source_account_present: true,
				candidate_count: 1,
				extracted_count: 1,
			}),
		);
		expect(JSON.stringify(report.privacySafeEvent)).not.toContain('passport');
		expect(JSON.stringify(report.privacySafeEvent)).not.toContain('scan');
	});
});
