'use client';

import { redactErrorMessage } from '@repo/shared';
import React from 'react';

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const developmentMessage = React.useMemo(
		() =>
			process.env.NODE_ENV === 'development' && error.message ? redactErrorMessage(error) : null,
		[error],
	);

	return (
		<div className="flex min-h-screen items-center justify-center bg-muted px-4">
			<div className="w-full max-w-md rounded-lg border border-red-200 bg-card p-8 shadow-stripe-sm">
				<h1 className="text-2xl font-bold text-red-900">Dashboard Error</h1>
				<p className="mt-2 text-sm text-red-700">
					Something went wrong while loading your dashboard.
				</p>

				{error.digest && (
					<div className="mt-4 rounded bg-red-50 p-3">
						<p className="text-xs font-mono text-red-600">Diagnostic code: {error.digest}</p>
					</div>
				)}

				{developmentMessage ? (
					<div className="mt-4 rounded bg-muted p-3">
						<p className="text-xs font-mono text-foreground">{developmentMessage}</p>
					</div>
				) : null}

				<button
					type="button"
					onClick={reset}
					className="mt-6 w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
				>
					Try Again
				</button>
			</div>
		</div>
	);
}
