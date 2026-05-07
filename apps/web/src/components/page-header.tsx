import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface PageHeaderProps {
	title: string;
	description?: string;
	breadcrumbs?: { label: string; href?: string }[];
	actions?: React.ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
	return (
		<div className="mb-6 flex flex-col gap-1">
			{breadcrumbs && breadcrumbs.length > 0 && (
				<Breadcrumb>
					<BreadcrumbList>
						{breadcrumbs.map((crumb, i) => (
							<BreadcrumbItem key={crumb.label}>
								{i > 0 && <BreadcrumbSeparator />}
								{crumb.href ? (
									<BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
								) : (
									<BreadcrumbPage>{crumb.label}</BreadcrumbPage>
								)}
							</BreadcrumbItem>
						))}
					</BreadcrumbList>
				</Breadcrumb>
			)}
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
					{description && <p className="text-sm text-muted-foreground">{description}</p>}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
		</div>
	);
}
