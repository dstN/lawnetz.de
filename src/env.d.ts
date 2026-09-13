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
