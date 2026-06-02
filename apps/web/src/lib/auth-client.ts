import { createAuthClient } from 'better-auth/react';

type AuthResult = {
	error?: {
		message?: string;
	} | null;
};

type GordianAuthClient = {
	signIn: {
		email(input: { email: string; password: string }): Promise<AuthResult>;
	};
	signOut(): Promise<unknown>;
	signUp: {
		email(input: { email: string; name?: string; password: string }): Promise<AuthResult>;
	};
};

export const authClient = createAuthClient() as GordianAuthClient;
