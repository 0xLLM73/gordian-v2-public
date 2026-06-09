#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import {
	type MessageContactCoverageReport,
	type MessageNullContactReasonReport,
	type PrivatePeerContactRepairResult,
	type SenderMetadataContactRepairResult,
	getMessageContactCoverageReport,
	getMessageNullContactReasonReport,
	repairMessagesToSenderContacts,
	repairPrivateMessagesToPeerContacts,
} from '@repo/db';
import { loadRootEnv } from './lib/load-root-env.mjs';

loadRootEnv();

interface CliOptions {
	write: boolean;
	workspaceId?: string;
}

interface MessageContactLinkageAuditResult {
	workspaceId: string;
	writeMode: boolean;
	before: MessageContactCoverageReport;
	nullContactReasons: MessageNullContactReasonReport;
	privatePeerRepair: PrivatePeerContactRepairResult;
	senderMetadataRepair: SenderMetadataContactRepairResult;
	after?: MessageContactCoverageReport;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { write: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--write') {
			options.write = true;
			continue;
		}
		if (arg === '--workspace-id') {
			const value = argv[i + 1];
			if (!value) throw new Error('--workspace-id requires a value');
			options.workspaceId = value;
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function renderCoverage(label: string, report: MessageContactCoverageReport): string[] {
	const lines = [
		label,
		`Total messages: ${report.totalMessages}`,
		`Messages with sender metadata: ${report.messagesWithSenderMetadata}`,
		`Messages with user sender metadata: ${report.messagesWithUserSenderMetadata}`,
		`Contact-linked messages: ${report.linkedContactMessages}`,
		`Null contact messages: ${report.nullContactMessages}`,
		`Null contact messages with sender metadata: ${report.nullContactMessagesWithSenderMetadata}`,
		`Null contact messages with user sender metadata: ${report.nullContactMessagesWithUserSenderMetadata}`,
		`Chats with null contact messages: ${report.chatsWithNullContactMessages}`,
		'Null contact messages by chat type:',
	];
	for (const row of report.byChatType) {
		lines.push(
			`- ${row.chatType}: ${row.nullContactMessages} null / ${row.totalMessages} total (${row.nullContactMessagesWithUserSenderMetadata} user-sender metadata, ${row.chatsWithNullContactMessages} chats)`,
		);
	}
	return lines;
}

function reasonLabel(reason: string): string {
	switch (reason) {
		case 'ambiguous_user_sender_contact':
			return 'user sender matched multiple contacts';
		case 'channel_not_person_addressable':
			return 'channel message is not person-addressable';
		case 'group_sender_metadata_missing':
			return 'group sender metadata missing';
		case 'non_user_sender':
			return 'sender is a chat or channel, not a user';
		case 'partial_sender_metadata':
			return 'partial sender metadata';
		case 'private_peer_contact_missing':
			return 'private peer contact missing';
		case 'repairable_user_sender_contact':
			return 'repairable user sender contact';
		case 'sender_metadata_missing':
			return 'sender metadata missing';
		case 'unmatched_user_sender_contact':
			return 'user sender has no matching contact';
		default:
			return reason;
	}
}

function renderNullContactReasons(report: MessageNullContactReasonReport): string[] {
	const lines = ['Null contact reasons'];
	if (report.reasons.length === 0) {
		lines.push('No null-contact messages found.');
		return lines;
	}

	for (const row of report.reasons) {
		lines.push(
			`- ${reasonLabel(row.reason)} (${row.chatType}): ${row.nullMessages} messages across ${row.chatsAffected} chats`,
		);
	}
	return lines;
}

export function renderMessageContactLinkageAuditResult(
	result: MessageContactLinkageAuditResult,
): string {
	const repair = result.privatePeerRepair;
	const senderRepair = result.senderMetadataRepair;
	const lines = [
		'Message Contact Linkage Audit',
		'=============================',
		`Workspace: ${result.workspaceId}`,
		`Mode: ${result.writeMode ? 'write' : 'dry-run'}`,
		'',
		...renderCoverage('Before', result.before),
		'',
		...renderNullContactReasons(result.nullContactReasons),
		'',
		'Private peer repair',
		`Private null messages: ${repair.privateNullMessages}`,
		`Repairable private messages: ${repair.repairableMessages}`,
		`Ambiguous private messages: ${repair.ambiguousMessages}`,
		`Unmatched private messages: ${repair.unmatchedMessages}`,
		`Private messages repaired: ${repair.repairedMessages}`,
		'',
		'User sender metadata repair',
		`Null messages with user sender metadata: ${senderRepair.nullUserSenderMessages}`,
		`Repairable sender-linked messages: ${senderRepair.repairableMessages}`,
		`Ambiguous sender-linked messages: ${senderRepair.ambiguousMessages}`,
		`Unmatched sender-linked messages: ${senderRepair.unmatchedMessages}`,
		`Sender-linked messages repaired: ${senderRepair.repairedMessages}`,
	];

	if (result.after) {
		lines.push('', ...renderCoverage('After', result.after));
	}

	lines.push(
		'',
		'Group and supergroup null-contact rows without user sender metadata were not modified. They need Telegram sender metadata from a re-fetch before they can be linked safely.',
		'No chat titles, contact names, Telegram message text, or snippets were printed.',
	);

	return lines.join('\n');
}

export async function runMessageContactLinkageAudit(
	workspaceId: string,
	options: Pick<CliOptions, 'write'>,
): Promise<MessageContactLinkageAuditResult> {
	const before = await getMessageContactCoverageReport(workspaceId);
	const nullContactReasons = await getMessageNullContactReasonReport(workspaceId);
	const privatePeerRepair = await repairPrivateMessagesToPeerContacts(workspaceId, {
		write: options.write,
	});
	const senderMetadataRepair = await repairMessagesToSenderContacts(workspaceId, {
		write: options.write,
	});
	const after = options.write ? await getMessageContactCoverageReport(workspaceId) : undefined;
	return {
		workspaceId,
		writeMode: options.write,
		before,
		nullContactReasons,
		privatePeerRepair,
		senderMetadataRepair,
		after,
	};
}

export async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.workspaceId) throw new Error('--workspace-id is required');

	const result = await runMessageContactLinkageAudit(options.workspaceId, options);
	console.log(renderMessageContactLinkageAuditResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('[message-contact-linkage-audit] Failed:', (error as Error).message);
		process.exit(1);
	});
}
