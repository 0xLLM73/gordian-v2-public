import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardError from './error';

describe('DashboardError', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('redacts development error details before rendering them', () => {
		vi.stubEnv('NODE_ENV', 'development');
		const error = new Error(
			'Command failed: security find-generic-password -a workspace-wrk:1f50aaea-32ce-4d96-8719-6cf6c3840dd7:4c630dd1-4e24-4862-9fe0-0121150d864f -s gordian-v2 -w',
		) as Error & { digest?: string };
		error.digest = '4038471285';

		render(React.createElement(DashboardError, { error, reset: () => undefined }));

		expect(screen.getByText('Diagnostic code: 4038471285')).toBeTruthy();
		expect(screen.queryByText(/workspace-wrk:1f50aaea/)).toBeNull();
		expect(screen.queryByText(/gordian-v2/)).toBeNull();
		expect(screen.getByText(/security find-generic-password -a \[redacted\]/)).toBeTruthy();
	});
});
