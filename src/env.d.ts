/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module '*.astro' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module '@layouts/*.astro' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module '@components/*.astro' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module 'country-flag-icons/string/3x2/*' {
	const content: string;
	export default content;
}
