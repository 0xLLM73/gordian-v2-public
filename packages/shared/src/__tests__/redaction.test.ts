import { describe, expect, it } from 'vitest';
import { redactErrorMessage, redactSensitive, redactText } from '../redaction';

describe('redaction utilities', () => {
	it('redacts common token, credential, and phone patterns', () => {
		const telegramApiHash = [
			'TELEGRAM_API_HASH',
			['abc', 'def', '123', '456', '789', '0'].join(''),
		].join('=');
		const botToken = [
			'BOT_TOKEN: "',
			['123456', ['ABC', 'def', 'GHI', 'jkl', 'MNO', 'pqr', 'STU'].join('')].join(':'),
			'"',
		].join('');
		const bareBotToken = [
			'123456',
			['abc', 'DEF', 'ghi', 'JKL', 'mno', 'PQR', 'stu'].join(''),
		].join(':');
		const input = [
			'https://api.telegram.org/bot123456:ABCdef/sendMessage',
			telegramApiHash,
			botToken,
			bareBotToken,
			'password="alpha beta gamma"',
			'Authorization: Bearer eyJhbGciOiJabc.eyJzdWIiOiIxMjMifQ.signaturevalue',
			'redis://default:secret@localhost:6379/0',
			'phone +1 (415) 555-2671',
			'due=2026-05-15',
			'security add-generic-password -a acct -s svc -w supersecret -U',
			'security find-generic-password -a telegram-session:4da901a7-131d-4c70-86b6-6a99008f67b1:656f07d7-b526-46d8-938b-e8679d9d7557 -s gordian-v2 -w',
			'security find-generic-password -a workspace-wrk:1f50aaea-32ce-4d96-8719-6cf6c3840dd7:4c630dd1-4e24-4862-9fe0-0121150d864f -s gordian-v2 -w',
		].join('\n');

		const redacted = redactText(input);

		expect(redacted).not.toContain('123456:ABCdef');
		expect(redacted).not.toContain(telegramApiHash);
		expect(redacted).not.toContain(botToken);
		expect(redacted).not.toContain(bareBotToken);
		expect(redacted).not.toContain('alpha beta gamma');
		expect(redacted).not.toContain('supersecret');
		expect(redacted).not.toContain('telegram-session:4da901a7');
		expect(redacted).not.toContain('workspace-wrk:1f50aaea');
		expect(redacted).not.toContain('gordian-v2');
		expect(redacted).not.toContain('default:secret');
		expect(redacted).not.toContain('+1 (415) 555-2671');
		expect(redacted).toContain('bot[redacted]');
		expect(redacted).toContain('[phone]');
		expect(redacted).toContain('due=2026-05-15');
	});

	it('handles Error objects without including stack by default', () => {
		const error = new Error('Failed with api_hash=abc123 and phone +15555550123');
		error.stack = 'Error: Failed\n    at secret stack line';

		const redacted = redactErrorMessage(error);

		expect(redacted).toContain('api_hash=[redacted]');
		expect(redacted).toContain('[phone]');
		expect(redacted).not.toContain('secret stack line');
	});

	it('redacts nested objects and circular values', () => {
		const fakeOpenAiKey = ['sk', 'testtesttesttesttesttest'].join('-');
		const value: { token: string; self?: unknown } = {
			token: fakeOpenAiKey,
		};
		value.self = value;

		const redacted = redactSensitive(value);

		expect(redacted).not.toContain(fakeOpenAiKey);
		expect(redacted).toContain('[circular]');
	});

	it('redacts nested Telegram message and identifier fields before log output', () => {
		const sentinel = 'CONFIDENTIAL TELEGRAM SENTINEL';
		const redacted = redactSensitive({
			error: 'worker failed',
			cause: new Error('safe operational failure with api_hash=abc123'),
			messageText: sentinel,
			source_account_id: '123456789',
			telegramId: '987654321',
			nested: {
				rawMessage: sentinel,
				messages: [{ text: sentinel }],
				safeStatus: 'failed',
			},
		});

		expect(redacted).toContain('worker failed');
		expect(redacted).toContain('safe operational failure');
		expect(redacted).toContain('api_hash=[redacted]');
		expect(redacted).toContain('safeStatus');
		expect(redacted).toContain('failed');
		expect(redacted).not.toContain(sentinel);
		expect(redacted).not.toContain('123456789');
		expect(redacted).not.toContain('987654321');
	});
});
