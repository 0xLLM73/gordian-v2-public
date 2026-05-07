'use client';

import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

interface OnboardingState {
	phone: string;
	normalizedPhone: string;
	consentAcknowledged: boolean;
	workspaceId: string | null;
}

interface OnboardingContextValue extends OnboardingState {
	hydrated: boolean;
	setPhone: (phone: string) => void;
	setNormalizedPhone: (phone: string) => void;
	setConsentAcknowledged: (acknowledged: boolean) => void;
	setWorkspaceId: (id: string) => void;
	clearOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const STORAGE_KEY = 'gordian-onboarding';

function loadState(): Partial<OnboardingState> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Partial<OnboardingState>;
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
	const clearOnboarding = useCallback(() => {
		if (typeof window !== 'undefined') {
			sessionStorage.removeItem(STORAGE_KEY);
		}
		setState({
			phone: '',
			normalizedPhone: '',
			consentAcknowledged: false,
			workspaceId: null,
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
