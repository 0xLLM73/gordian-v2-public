import { getDemoLoginSafety } from '@/lib/local-data-safety';
import { LoginForm } from './login-form';

export default async function LoginPage() {
	return <LoginForm demoLogin={await getDemoLoginSafety()} />;
}
