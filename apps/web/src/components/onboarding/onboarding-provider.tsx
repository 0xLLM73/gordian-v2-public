'use client';

import {
	DEFAULT_TELEGRAM_SYNC_SCOPE,
	TELEGRAM_SYNC_SCOPES,
	type TelegramSyncScope,
} from '@repo/shared';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

interface OnboardingState {
	phone: string;
	normalizedPhone: string;
	consentAcknowledged: boolean;
	workspaceId: string | null;
	syncScope: TelegramSyncScope;
	enableAiProcessing: boolean;
}

interface OnboardingContextValue extends OnboardingState {
	hydrated: boolean;
	setPhone: (phone: string) => void;
	setNormalizedPhone: (phone: string) => void;
	setConsentAcknowledged: (acknowledged: boolean) => void;
	setWorkspaceId: (id: string) => void;
	setSyncScope: (scope: TelegramSyncScope) => void;
	setEnableAiProcessing: (enabled: boolean) => void;
	clearOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const STORAGE_KEY = 'gordian-onboarding';

function loadState(): Partial<OnboardingState> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Partial<OnboardingState>;
		if (parsed.syncScope && !TELEGRAM_SYNC_SCOPES.includes(parsed.syncScope as TelegramSyncScope)) {
			parsed.syncScope = DEFAULT_TELEGRAM_SYNC_SCOPE;
		}
		if (typeof parsed.enableAiProcessing !== 'boolean') {
			parsed.enableAiProcessing = false;
		}
		return parsed;
	} catch {
		return {};
	}
}

function saveState(state: OnboardingState) {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// sessionStorage full or unavailable
	}
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<OnboardingState>({
		phone: '',
		normalizedPhone: '',
		consentAcknowledged: false,
		workspaceId: null,
		syncScope: DEFAULT_TELEGRAM_SYNC_SCOPE,
		enableAiProcessing: false,
	});
	const [hydrated, setHydrated] = useState(false);

	// Hydrate from sessionStorage on mount
	useEffect(() => {
		const saved = loadState();
		setState((prev) => ({ ...prev, ...saved }));
		setHydrated(true);
	}, []);

	// Persist to sessionStorage on change (after hydration)
	useEffect(() => {
		if (!hydrated) return;
		saveState(state);
	}, [state, hydrated]);

	const setPhone = useCallback((phone: string) => setState((prev) => ({ ...prev, phone })), []);
	const setNormalizedPhone = useCallback(
		(normalizedPhone: string) => setState((prev) => ({ ...prev, normalizedPhone })),
		[],
	);
	const setConsentAcknowledged = useCallback(
		(consentAcknowledged: boolean) => setState((prev) => ({ ...prev, consentAcknowledged })),
		[],
	);
	const setWorkspaceId = useCallback(
		(workspaceId: string) => setState((prev) => ({ ...prev, workspaceId })),
		[],
	);
	const setSyncScope = useCallback(
		(syncScope: TelegramSyncScope) => setState((prev) => ({ ...prev, syncScope })),
		[],
	);
	const setEnableAiProcessing = useCallback(
		(enableAiProcessing: boolean) => setState((prev) => ({ ...prev, enableAiProcessing })),
		[],
	);
	const clearOnboarding = useCallback(() => {
		if (typeof window !== 'undefined') {
			sessionStorage.removeItem(STORAGE_KEY);
		}
		setState({
			phone: '',
			normalizedPhone: '',
			consentAcknowledged: false,
			workspaceId: null,
			syncScope: DEFAULT_TELEGRAM_SYNC_SCOPE,
			enableAiProcessing: false,
		});
	}, []);

	return (
		<OnboardingContext.Provider
			value={{
				...state,
				hydrated,
				setPhone,
				setNormalizedPhone,
				setConsentAcknowledged,
				setWorkspaceId,
				setSyncScope,
				setEnableAiProcessing,
				clearOnboarding,
			}}
		>
			{children}
		</OnboardingContext.Provider>
	);
}

export function useOnboarding() {
	const ctx = useContext(OnboardingContext);
	if (!ctx) {
		throw new Error('useOnboarding must be used within OnboardingProvider');
	}
	return ctx;
}
