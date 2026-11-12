import type { Page } from '@playwright/test';

/**
 * WCAG 2.2 AAA checks that axe-core has no rules for.
 *
 * Taken from bewerby (tests/e2e/fixtures/aaa.ts) and kept framework-free, so
 * the two copies can be compared line by line. Changes here: print-only style
 * rules are not screen presentation and are skipped for 1.4.8; an inline
 * component that wraps is hit-tested per line box for 2.4.12; overlapping
 * targets fail 2.5.5 only when no free 44x44 square is left of the lower one;
 * for 2.4.8 a link with another query string is another page; and a text field
 * focused partly below the fold is not obscured (the browser scrolls to the
 * caret, not to the whole field).
 *
 * axe ships three AAA rules (enhanced contrast, identical link purpose, meta
 * refresh). Everything below is AAA that can still be read off the rendered
 * page, written against the W3C "Understanding" documents for each criterion:
 *
 * - 2.5.5 Target Size (Enhanced): pointer targets are at least 44x44 CSS px
 *   and do not overlap, since an overlapped target is smaller than its box.
 *   Exceptions as the criterion words them: links inside a sentence or block
 *   of text, and controls the browser sizes that the author has not resized.
 *   The "equivalent control elsewhere" exception is not machine-checkable, so
 *   it is not relied on.
 * - 1.4.8 Visual Presentation, for blocks of text (more than one sentence, as
 *   Understanding 1.4.8 defines them, and every <p> as Siteimprove's SIA-R73
 *   does): not justified, line height at least 1.5, lines at most 80
 *   characters (measured in `ch`), and paragraph spacing at least 1.5 times
 *   the line spacing. Understanding 1.4.8 measures that last one from the top
 *   of a paragraph's last line to the top of the next one's first line, at
 *   250% of single spacing; single spacing is taken as the font size. Font
 *   sizes are relative, so the browser's own text size setting reaches them
 *   (SIA-R74). Reflow at 320px is a11y.spec.ts's job.
 * - 2.4.8 Location: every navigation link to the current page carries
 *   aria-current="page" (technique ARIA26), and no other link does.
 * - 2.1.3 Keyboard (No Exception): every focusable control is reached by Tab.
 * - 2.4.12 Focus Not Obscured (Enhanced): the focused component is fully
 *   visible, i.e. hit-testing every part of it lands on the component itself
 *   and not on a sticky bar, an overlay or a clipping scroll container.
 * - 2.4.13 Focus Appearance: the focus indicator is an outline at least 2px
 *   thick (3px when drawn inside the component, which shrinks its perimeter),
 *   not clipped by an ancestor, with 3:1 between the outline's colour and the
 *   pixels it covers in the unfocused state.
 *
 * The probe runs in the page, so it is one self-contained function: Playwright
 * serialises it, and it cannot reach anything outside its own body.
 */

type Mode = 'static' | 'focus-start' | 'focus-step' | 'focus-end';
interface ProbeResult {
	done: boolean;
	problems: string[];
}

function probe(mode: Mode): ProbeResult {
	type Rgba = [number, number, number, number];
	interface WalkState {
		visited: Set<Element>;
		bodies: number;
	}
	const store = window as unknown as { __aaaWalk?: WalkState };
	const problems: string[] = [];

	const describe = (el: Element): string => {
		const classes = [...el.classList];
		const selector = el.id ? `#${el.id}` : classes.length ? `.${classes.join('.')}` : '';
		const text = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 40);
		return `<${el.tagName.toLowerCase()}${selector}> "${text}"`;
	};

	const parseColor = (value: string): Rgba | null => {
		const m = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
		return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
	};

	/** Composites the background colours from `start` upwards until one is opaque. */
	const backgroundBehind = (start: Element | null): Rgba | null => {
		const layers: Rgba[] = [];
		for (let el = start; el; el = el.parentElement) {
			const colour = parseColor(getComputedStyle(el).backgroundColor);
			if (!colour) return null;
			if (colour[3] > 0) layers.push(colour);
			if (colour[3] >= 1) break;
		}
		let [r, g, b] = [255, 255, 255];
		for (const [lr, lg, lb, a] of layers.reverse()) {
			[r, g, b] = [lr * a + r * (1 - a), lg * a + g * (1 - a), lb * a + b * (1 - a)];
		}
		return [r, g, b, 1];
	};

	const contrast = (x: Rgba, y: Rgba): number => {
		const lum = ([r, g, b]: Rgba): number => {
			const [lr, lg, lb] = [r, g, b].map((v) => {
				const c = v / 255;
				return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
		};
		const [hi, lo] = [lum(x), lum(y)].sort((a, b) => b - a);
		return (hi + 0.05) / (lo + 0.05);
	};

	const display = (el: Element): string => getComputedStyle(el).display;

	// A modal <dialog> makes everything outside it inert without an attribute.
	const modal = document.querySelector('dialog:modal');
	const isLive = (el: Element): boolean => {
		if (el.closest('[inert]') || (modal && !modal.contains(el))) return false;
		if (el.matches(':disabled')) return false;
		if (!el.checkVisibility({ visibilityProperty: true })) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	};
	const isVisuallyHidden = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		return r.width <= 1 || r.height <= 1;
	};
	/** A visually hidden input is operated through its label, which then is the target. */
	const visibleStandIn = (el: Element): Element | null => {
		if (!isVisuallyHidden(el)) return el;
		const labels = el instanceof HTMLInputElement ? [...(el.labels ?? [])] : [];
		return labels.find((l) => !isVisuallyHidden(l)) ?? null;
	};

	const FOCUSABLE =
		'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
	const TARGETS = `${FOCUSABLE}, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="option"], [role="menuitem"]`;

	if (mode === 'static') {
		// ——— 2.5.5 Target Size (Enhanced) ———
		const inSentence = (el: Element): boolean => {
			if (display(el) !== 'inline') return false;
			let block = el.parentElement;
			while (block && /^(inline|contents)$/.test(display(block))) block = block.parentElement;
			const own = (el.textContent ?? '').trim().length;
			return !!block && (block.textContent ?? '').trim().length > own;
		};
		// Chromium draws an untouched checkbox or radio at 13x13. Any other size
		// means the author resized it, and then the exception no longer applies.
		const isUntouchedUaControl = (el: Element): boolean => {
			if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) {
				return false;
			}
			const r = el.getBoundingClientRect();
			return getComputedStyle(el).appearance !== 'none' && r.width <= 13.5 && r.height <= 13.5;
		};
		// A checkbox or radio toggles from anywhere on its label, so a 44px
		// label is the equivalent control the criterion accepts in place of a
		// 44px box (Siteimprove's SIA-R111 notes that ignoring labels gives
		// false positives). The largest label is the one that counts.
		const labelTarget = (el: Element): Element | null => {
			if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) {
				return null;
			}
			const area = (l: Element) =>
				l.getBoundingClientRect().width * l.getBoundingClientRect().height;
			return [...(el.labels ?? [])].sort((a, b) => area(b) - area(a))[0] ?? null;
		};
		const targets = new Set<Element>();
		for (const el of document.querySelectorAll(TARGETS)) {
			if (!isLive(el) || inSentence(el) || isUntouchedUaControl(el)) continue;
			const target = labelTarget(el) ?? visibleStandIn(el);
			if (target) targets.add(target);
		}
		// A label standing in for a file input that is not rendered at all is
		// the only thing there is to click.
		for (const label of document.querySelectorAll('label')) {
			const control = label.control;
			if (control instanceof HTMLInputElement && control.type === 'file' && isLive(label)) {
				if (!control.checkVisibility()) targets.add(label);
			}
		}
		for (const target of targets) {
			const r = target.getBoundingClientRect();
			if (r.width < 43.5 || r.height < 43.5) {
				problems.push(
					`2.5.5 target ${Math.round(r.width)}x${Math.round(r.height)} < 44x44: ${describe(target)}`
				);
			}
		}
		// Where two targets overlap, the one painted on top takes the overlap,
		// so the other is smaller than its box: it still passes while a 44x44
		// square fits in what is left of it (an icon button inside a wide search
		// field). A target nested in another (a label around its input) is one
		// target, and a popover is a layer of its own above the page. Two targets
		// in the same scroll container overlap wherever it is scrolled to; across
		// containers, each box is first cut to what its own containers show, or a
		// field scrolled out of a dialog's body would seem to sit under the
		// dialog's footer.
		const overlap = (a: DOMRect, b: DOMRect): [number, number] => [
			Math.min(a.right, b.right) - Math.max(a.left, b.left),
			Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
		];
		const intersection = (a: DOMRect, b: DOMRect): DOMRect => {
			const [left, top] = [Math.max(a.left, b.left), Math.max(a.top, b.top)];
			return new DOMRect(left, top, overlap(a, b)[0], overlap(a, b)[1]);
		};
		const covers = new Map<Element, { by: Element; rect: DOMRect }[]>();
		/** The square can always be slid until it touches the box or a cover. */
		const freeSquare = (box: DOMRect, cut: DOMRect[]): boolean => {
			const xs = [box.left, box.right - 44, ...cut.flatMap((c) => [c.right, c.left - 44])];
			const ys = [box.top, box.bottom - 44, ...cut.flatMap((c) => [c.bottom, c.top - 44])];
			return xs.some((x) =>
				ys.some((y) => {
					if (x < box.left - 0.5 || y < box.top - 0.5) return false;
					if (x + 44 > box.right + 0.5 || y + 44 > box.bottom + 0.5) return false;
					const square = new DOMRect(x, y, 44, 44);
					return cut.every((c) => {
						const [w, h] = overlap(square, c);
						return w <= 0.5 || h <= 0.5;
					});
				})
			);
		};
		const shownBelow = (el: Element, shared: Element): DOMRect => {
			let r = el.getBoundingClientRect();
			for (let a = el.parentElement; a && a !== shared; a = a.parentElement) {
				const style = getComputedStyle(a);
				if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
					const c = a.getBoundingClientRect();
					const [left, top] = [Math.max(r.left, c.left), Math.max(r.top, c.top)];
					const [right, bottom] = [Math.min(r.right, c.right), Math.min(r.bottom, c.bottom)];
					r = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
				}
				if (style.position === 'fixed' || a.matches('dialog:modal, :popover-open')) break;
			}
			return r;
		};
		const list = [...targets];
		for (const [i, a] of list.entries()) {
			for (const b of list.slice(i + 1)) {
				if (a.contains(b) || b.contains(a)) continue;
				if (a.closest(':popover-open') !== b.closest(':popover-open')) continue;
				const [rawW, rawH] = overlap(a.getBoundingClientRect(), b.getBoundingClientRect());
				if (rawW <= 0.5 || rawH <= 0.5) continue;
				let shared = a.parentElement ?? document.documentElement;
				while (!shared.contains(b)) shared = shared.parentElement ?? document.documentElement;
				const [shownA, shownB] = [shownBelow(a, shared), shownBelow(b, shared)];
				const [w, h] = overlap(shownA, shownB);
				if (w <= 0.5 || h <= 0.5) continue;
				// Whichever hit-testing finds in the middle of the overlap is on
				// top; off screen, the later one in the document paints later.
				const rect = intersection(shownA, shownB);
				const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
				const aOnTop = !!hit && (hit === a || a.contains(hit));
				const [lower, upper] = aOnTop ? [b, a] : [a, b];
				covers.set(lower, [...(covers.get(lower) ?? []), { by: upper, rect }]);
			}
		}
		for (const [lower, cut] of covers) {
			if (freeSquare(lower.getBoundingClientRect(), cut.map((c) => c.rect))) continue;
			const { by, rect } = cut[0];
			problems.push(
				`2.5.5 no free 44x44 left in ${describe(lower)}: ` +
					`${describe(by)} covers ${Math.round(rect.width)}x${Math.round(rect.height)}`
			);
		}

		// ——— 1.4.8 Visual Presentation (blocks of text) ———
		const textByBlock = new Map<Element, Text[]>();
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent?.trim()) continue;
			let block = node.parentElement;
			while (block && /^(inline|contents)$/.test(display(block))) block = block.parentElement;
			if (!block || block.closest('script, style, svg, textarea, [aria-hidden="true"]')) continue;
			textByBlock.set(block, [...(textByBlock.get(block) ?? []), node as Text]);
		}
		const lineTops = (nodes: Text[]): DOMRect[] =>
			nodes.flatMap((n) => {
				const range = document.createRange();
				range.selectNodeContents(n);
				return [...range.getClientRects()].filter((r) => r.width > 0);
			});
		const canvas = document.createElement('canvas').getContext('2d');
		const blocks = new Map<Element, DOMRect[]>();
		for (const [block, nodes] of textByBlock) {
			const text = nodes.map((n) => n.textContent).join('');
			// A sentence ends after a word of two or more letters, so neither "1."
			// in a numbered heading nor "z. B." counts as a boundary.
			const sentences = text.trim().split(/(?<=\p{L}{2}[.!?…]["“”»)]?)\s+(?=[„"«(\p{Lu}])/u).length;
			if (sentences < 2 && block.tagName !== 'P') continue;
			if (!isLive(block) || isVisuallyHidden(block)) continue;
			const rects = lineTops(nodes);
			if (!rects.length) continue;
			blocks.set(block, rects);
			const s = getComputedStyle(block);
			const fontSize = parseFloat(s.fontSize);
			if (s.textAlign === 'justify') problems.push(`1.4.8 justified text: ${describe(block)}`);
			const lineHeight = s.lineHeight === 'normal' ? 0 : parseFloat(s.lineHeight) / fontSize;
			if (lineHeight < 1.49) {
				problems.push(
					`1.4.8 line height ${lineHeight ? lineHeight.toFixed(2) : 'normal'} < 1.5: ${describe(block)}`
				);
			}
			if (canvas) {
				canvas.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
				const limit = 80 * canvas.measureText('0').width;
				const lines = new Map<number, { left: number; right: number }>();
				for (const r of rects) {
					const key = Math.round(r.top);
					const line = lines.get(key) ?? { left: r.left, right: r.right };
					lines.set(key, {
						left: Math.min(line.left, r.left),
						right: Math.max(line.right, r.right)
					});
				}
				const longest = Math.max(...[...lines.values()].map((l) => l.right - l.left));
				if (longest > limit + 1) {
					problems.push(
						`1.4.8 line ${Math.round(longest)}px > 80ch (${Math.round(limit)}px): ${describe(block)}`
					);
				}
			}
		}
		for (const [block, rects] of blocks) {
			const next = block.nextElementSibling;
			const nextRects = next && blocks.get(next);
			if (!nextRects) continue;
			const fontSize = parseFloat(getComputedStyle(block).fontSize);
			const lastTop = Math.max(...rects.map((r) => r.top));
			const firstTop = Math.min(...nextRects.map((r) => r.top));
			if (firstTop - lastTop < 2.5 * fontSize - 0.5) {
				problems.push(
					`1.4.8 paragraph spacing ${((firstTop - lastTop) / fontSize).toFixed(2)}em < 2.5em top to top: ${describe(block)}`
				);
			}
		}

		const absolute = /\d(px|pt|pc|cm|mm|in|q)$/i;
		const visit = (rules: CSSRuleList): void => {
			for (const rule of rules) {
				// Points are the right unit on paper; 1.4.8 is about the screen.
				if (rule instanceof CSSMediaRule && /^print$/i.test(rule.media.mediaText.trim())) continue;
				if (rule instanceof CSSStyleRule && absolute.test(rule.style.fontSize)) {
					problems.push(
						`1.4.8 font-size ${rule.style.fontSize} in absolute units: ${rule.selectorText}`
					);
				}
				if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) visit(rule.cssRules);
			}
		};
		for (const sheet of document.styleSheets) visit(sheet.cssRules);
		for (const el of document.querySelectorAll<HTMLElement>('[style*="font-size"]')) {
			if (absolute.test(el.style.fontSize)) {
				problems.push(`1.4.8 font-size ${el.style.fontSize} in absolute units: ${describe(el)}`);
			}
		}

		// ——— 2.4.8 Location ———
		for (const a of document.querySelectorAll<HTMLAnchorElement>('nav a[href]')) {
			const url = new URL(a.href);
			// A query string can be a page of its own (/gesetze?buchstabe=A).
			const here =
				url.origin === location.origin &&
				url.pathname === location.pathname &&
				url.search === location.search &&
				!url.hash;
			if (here !== (a.getAttribute('aria-current') === 'page')) {
				problems.push(
					`2.4.8 ${here ? 'missing' : 'wrong'} aria-current="page" on ${describe(a)} (${url.pathname})`
				);
			}
		}
		return { done: true, problems };
	}

	if (mode === 'focus-start') {
		(document.activeElement as HTMLElement | null)?.blur();
		store.__aaaWalk = { visited: new Set(), bodies: 0 };
		return { done: false, problems };
	}

	const walk = store.__aaaWalk;
	if (!walk) return { done: true, problems: ['focus walk was not started'] };

	if (mode === 'focus-end') {
		// ——— 2.1.3 Keyboard (No Exception) ———
		const visitedRadioGroups = new Set(
			[...walk.visited]
				.filter(
					(el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio'
				)
				.map((el) => el.name)
		);
		for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
			if (walk.visited.has(el) || el.tabIndex < 0 || !isLive(el)) continue;
			if (
				el instanceof HTMLInputElement &&
				el.type === 'radio' &&
				visitedRadioGroups.has(el.name)
			) {
				continue;
			}
			problems.push(`2.1.3 not reachable with Tab: ${describe(el)}`);
		}
		delete store.__aaaWalk;
		return { done: true, problems };
	}

	// mode === 'focus-step'
	const focused = document.activeElement;
	if (!focused || focused === document.body) {
		walk.bodies += 1;
		return { done: walk.bodies >= 2, problems };
	}
	if (walk.visited.has(focused)) return { done: true, problems };
	walk.visited.add(focused);
	const shown = visibleStandIn(focused) ?? focused;
	const r = shown.getBoundingClientRect();

	// ——— 2.4.12 Focus Not Obscured (Enhanced) ———
	// A 3x3 grid over the component, 2px in from its edges. The corner points
	// move further in along a rounded corner, which hit-testing honours. A
	// wrapped inline link is one grid per line: its bounding box also covers
	// the words of the sentence around it.
	const fragments =
		display(shown) === 'inline' ? [...shown.getClientRects()].filter((f) => f.width > 4) : [r];
	const points = fragments.flatMap((f) => {
		const radius = Math.min(
			parseFloat(getComputedStyle(shown).borderTopLeftRadius) || 0,
			f.width / 2,
			f.height / 2
		);
		const xs = [f.left + 2, f.left + f.width / 2, f.right - 2];
		const ys = [f.top + 2, f.top + f.height / 2, f.bottom - 2];
		return xs.flatMap((x, i) =>
			ys.map((y, j) => {
				const inset = i !== 1 && j !== 1 ? radius * 0.3 : 0;
				return [x + (i ? -inset : inset), y + (j ? -inset : inset)];
			})
		);
	});
	// A component that fits the viewport but sits partly outside it was not
	// scrolled into view, which the browser does on focus. Text fields are the
	// exception: Chrome scrolls to their caret, not their box, and the rest is
	// off screen rather than hidden by anything the page drew.
	const scrollsToCaret = shown.matches('textarea, input:not([type="checkbox"], [type="radio"])');
	const fits = r.width <= innerWidth && r.height <= innerHeight && !scrollsToCaret;
	const hidden = points.filter(([x, y]) => {
		if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return fits;
		const hit = document.elementFromPoint(x, y);
		return !hit || !(hit === shown || shown.contains(hit) || hit === focused);
	});
	if (hidden.length) {
		const [x, y] = hidden[0];
		const hit = document.elementFromPoint(x, y);
		problems.push(
			`2.4.12 focused ${describe(focused)} is covered at ${hidden.length}/${points.length} points` +
				(hit ? ` by ${describe(hit)}` : ' (outside the viewport)')
		);
	}

	// ——— 2.4.13 Focus Appearance ———
	const s = getComputedStyle(shown);
	const width = s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth);
	const offset = parseFloat(s.outlineOffset) || 0;
	const minWidth = offset + width <= 0 ? 3 : 2;
	if (width < minWidth) {
		problems.push(`2.4.13 focus outline ${width}px < ${minWidth}px: ${describe(focused)}`);
	} else {
		const outline = parseColor(s.outlineColor);
		// Outside the component the outline covers what is behind it; drawn
		// inside, it covers the component's own background.
		const under = backgroundBehind(offset + width <= 0 ? shown : shown.parentElement);
		if (!outline || !under) {
			problems.push(`2.4.13 focus outline colour unreadable: ${describe(focused)}`);
		} else if (contrast(outline, under) < 3) {
			problems.push(
				`2.4.13 focus outline contrast ${contrast(outline, under).toFixed(2)}:1 < 3:1: ${describe(focused)}`
			);
		}
		// An ancestor that clips its overflow also clips the outline.
		const reach = Math.max(offset + width, 0);
		const ring = { l: r.left - reach, t: r.top - reach, r: r.right + reach, b: r.bottom + reach };
		for (
			let el = shown.parentElement;
			el && el !== document.documentElement;
			el = el.parentElement
		) {
			const o = getComputedStyle(el);
			if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
			const c = el.getBoundingClientRect();
			const clipped =
				(o.overflowX !== 'visible' && (ring.l < c.left - 0.5 || ring.r > c.right + 0.5)) ||
				(o.overflowY !== 'visible' && (ring.t < c.top - 0.5 || ring.b > c.bottom + 0.5));
			if (clipped) {
				problems.push(`2.4.13 focus outline clipped by ${describe(el)}: ${describe(focused)}`);
				break;
			}
			// Nothing above the top layer or a fixed box clips what is inside it.
			if (el.matches('dialog:modal, :popover-open') || o.position === 'fixed') break;
		}
	}
	return { done: false, problems };
}

/**
 * Reduced motion shortens every transition to 0.01ms - including the implicit
 * `all` that also covers the focus outline and a dialog's opening transform -
 * but a transition still only completes on the next frame. Read before that,
 * the outline is its unfocused self and the dialog still mid-scale.
 */
function settle(page: Page): Promise<unknown> {
	return page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
}

/** Everything on the page as it stands: target size, text blocks, location. */
export async function staticViolations(page: Page): Promise<string[]> {
	await settle(page);
	return (await page.evaluate<ProbeResult, Mode>(probe, 'static')).problems;
}

/**
 * Tabs through the page (or the open modal dialog) from the top until focus
 * comes round again, checking each stop, then reports what Tab never reached.
 */
export async function keyboardViolations(page: Page): Promise<string[]> {
	await page.evaluate<ProbeResult, Mode>(probe, 'focus-start');
	const problems: string[] = [];
	for (let stop = 0; ; stop++) {
		if (stop === 400) return [...problems, 'focus walk did not come round within 400 Tab stops'];
		await page.keyboard.press('Tab');
		await settle(page);
		const step = await page.evaluate<ProbeResult, Mode>(probe, 'focus-step');
		problems.push(...step.problems);
		if (step.done) break;
	}
	return [...problems, ...(await page.evaluate<ProbeResult, Mode>(probe, 'focus-end')).problems];
}
