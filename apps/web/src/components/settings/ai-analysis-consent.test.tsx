import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAnalysisConsent } from './ai-analysis-consent';

const mockSaveConsentAction = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);

vi.mock('@/app/actions/calibration', () => ({
	saveConsentAction: mockSaveConsentAction,
}));

describe('AiAnalysisConsent', () => {
	beforeEach(() => {
		mockSaveConsentAction.mockReset();
		mockSaveConsentAction.mockResolvedValue({ data: { saved: true } });
	});

	it('persists explicit AI analysis consent while preserving Telegram access consent', async () => {
		render(
			<AiAnalysisConsent
				aiAvailable={true}
				consentAiAnalysis={false}
				consentDataProcessing={true}
				consentTelegramAccess={true}
			/>,
		);

		fireEvent.click(screen.getByRole('checkbox'));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() =>
			expect(mockSaveConsentAction).toHaveBeenCalledWith({
				consentDataProcessing: true,
				consentAiAnalysis: true,
				consentTelegramAccess: true,
				consentVersion: 2,
			}),
		);
		expect(await screen.findByText('Saved')).toBeTruthy();
	});

	it('keeps AI consent disabled when no AI runtime is available', () => {
		render(
			<AiAnalysisConsent
				aiAvailable={false}
				consentAiAnalysis={false}
				consentDataProcessing={true}
				consentTelegramAccess={true}
			/>,
		);

		expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
		expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
		expect(
			screen.getByText('Local or vendor AI analysis is not configured for this build.'),
		).toBeTruthy();
	});
});
