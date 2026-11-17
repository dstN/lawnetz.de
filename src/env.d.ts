/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

/** Set by astro.config.ts at build time: when this build was made (an HTTP date). */
declare const __BUILT_AT__: string;

declare module '*.astro' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module '@layouts/*' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module '@components/*' {
	type AstroComponentFactory = any;
	const Component: AstroComponentFactory;
	export default Component;
}

declare module 'country-flag-icons/string/3x2/*' {
	const content: string;
	export default content;
}
