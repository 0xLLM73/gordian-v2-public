import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCalendarConnection = vi.fn();
const mockUpsertCalendarEvent = vi.fn();
const mockMatchAttendeeToContact = vi.fn();
const mockUpdateCalendarLastSync = vi.fn();

const mockDb = {
	select: vi.fn(),
};

vi.mock('@repo/db', () => ({
	calendarConnections: { workspaceId: 'workspace_id' },
	workspaces: {
		id: 'id',
		encryptedWrk: 'encrypted_wrk',
		kmsContext: 'kms_context',
		wrkVersion: 'wrk_version',
	},
	db: mockDb,
	eq: vi.fn(),
	getCalendarConnection: mockGetCalendarConnection,
	upsertCalendarEvent: mockUpsertCalendarEvent,
	matchAttendeeToContact: mockMatchAttendeeToContact,
	updateCalendarLastSync: mockUpdateCalendarLastSync,
	updateCalendarTokens: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Helper: mock the calendarConnections workspace query (1st db.select call) */
function mockConnectionsQuery(workspaceIds: string[]) {
	mockDb.select.mockReturnValueOnce({
		from: vi.fn().mockResolvedValue(workspaceIds.map((id) => ({ workspaceId: id }))),
	});
}

/** Helper: mock the getWorkspaceEnvelope query (subsequent db.select call) */
function mockEnvelopeQuery(exists = true) {
	mockDb.select.mockReturnValueOnce({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(
					exists
						? [
								{
									encryptedWrk: Buffer.from('test').toString('base64'),
									kmsContext: {},
									wrkVersion: 1,
								},
							]
						: [],
				),
			}),
		}),
	});
}

describe('calendar-sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('skips when no connections exist', async () => {
		mockConnectionsQuery([]);

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('skips connections without access tokens', async () => {
		mockConnectionsQuery(['ws-1']);
		mockEnvelopeQuery();
		mockGetCalendarConnection.mockResolvedValue({ id: 'conn-1', accessToken: null });

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('fetches and upserts calendar events', async () => {
		mockConnectionsQuery(['ws-1']);
		mockEnvelopeQuery();
		mockGetCalendarConnection.mockResolvedValue({
			id: 'conn-1',
			accessToken: 'token-abc',
			refreshToken: null,
		});

		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					items: [
						{
							id: 'evt-1',
							summary: 'Meeting with Alice',
							start: { dateTime: '2026-02-18T10:00:00Z' },
							end: { dateTime: '2026-02-18T11:00:00Z' },
							attendees: [{ email: 'alice@example.com', displayName: 'Alice' }],
						},
					],
				}),
		});

		mockUpsertCalendarEvent.mockResolvedValue({ id: 'cal-evt-1' });
		mockMatchAttendeeToContact.mockResolvedValue(null);
		mockUpdateCalendarLastSync.mockResolvedValue(undefined);

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockUpsertCalendarEvent).toHaveBeenCalledWith(
			'ws-1',
			'conn-1',
			expect.objectContaining({ externalId: 'evt-1', title: 'Meeting with Alice' }),
			expect.objectContaining({ wrkVersion: 1 }),
		);
		expect(mockMatchAttendeeToContact).toHaveBeenCalledWith(
			'ws-1',
			'cal-evt-1',
			['alice@example.com'],
			expect.objectContaining({ wrkVersion: 1 }),
		);
		expect(mockUpdateCalendarLastSync).toHaveBeenCalledWith('ws-1', 'conn-1');
	});

	it('handles API errors gracefully', async () => {
		mockConnectionsQuery(['ws-2']);
		mockEnvelopeQuery();
		mockGetCalendarConnection.mockResolvedValue({
			id: 'conn-2',
			accessToken: 'token-bad',
			refreshToken: null,
		});
		mockFetch.mockResolvedValue({ ok: false, status: 401 });

		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		expect(mockUpsertCalendarEvent).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[calendar-sync] API error'));
		consoleError.mockRestore();
	});

	it('skips events without id or start', async () => {
		mockConnectionsQuery(['ws-3']);
		mockEnvelopeQuery();
		mockGetCalendarConnection.mockResolvedValue({
			id: 'conn-3',
			accessToken: 'token-ok',
			refreshToken: null,
		});

		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					items: [
						{ summary: 'No ID event', start: { dateTime: '2026-02-18T10:00:00Z' } },
						{ id: 'evt-no-start' },
						{
							id: 'evt-valid',
							summary: 'Valid event',
							start: { dateTime: '2026-02-18T14:00:00Z' },
						},
					],
				}),
		});

		mockUpsertCalendarEvent.mockResolvedValue({ id: 'cal-valid' });
		mockMatchAttendeeToContact.mockResolvedValue(null);
		mockUpdateCalendarLastSync.mockResolvedValue(undefined);

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		// Only the valid event should be upserted
		expect(mockUpsertCalendarEvent).toHaveBeenCalledTimes(1);
		expect(mockUpsertCalendarEvent).toHaveBeenCalledWith(
			'ws-3',
			'conn-3',
			expect.objectContaining({ externalId: 'evt-valid' }),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('continues processing other workspaces on failure', async () => {
		mockConnectionsQuery(['ws-fail', 'ws-ok']);
		// Envelopes for both workspaces
		mockEnvelopeQuery();
		mockEnvelopeQuery();

		mockGetCalendarConnection
			.mockResolvedValueOnce({
				id: 'conn-fail',
				accessToken: 'token-fail',
				refreshToken: null,
			})
			.mockResolvedValueOnce({
				id: 'conn-ok',
				accessToken: 'token-ok',
				refreshToken: null,
			});

		mockFetch.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ items: [] }),
		});

		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { syncCalendarEvents } = await import('../calendar-sync');
		await syncCalendarEvents();

		// Second workspace should still be processed
		expect(mockUpdateCalendarLastSync).toHaveBeenCalledWith('ws-ok', 'conn-ok');
		consoleError.mockRestore();
	});
});
