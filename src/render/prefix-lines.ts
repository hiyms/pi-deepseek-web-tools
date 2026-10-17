import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface PrefixLine {
	prefix: string;
	text: string;
	continuationPrefix?: string;
}

/**
 * Wraps each logical line with its own prefix. pi-tui's Text drops the leading
 * indentation when a long line wraps; result rows need to keep it.
 */
export class PrefixLines implements Component {
	constructor(private readonly lines: PrefixLine[]) {}

	invalidate(): void {}

	render(width: number): string[] {
		const output: string[] = [];
		for (const line of this.lines) {
			const continuation = line.continuationPrefix ?? line.prefix;
			for (const source of line.text.split("\n")) {
				if (source === "") {
					output.push(truncateToWidth(line.prefix, width, "", true));
					continue;
				}
				let remaining = source;
				let first = true;
				while (remaining.length > 0) {
					const usedPrefix = first ? line.prefix : continuation;
					const available = Math.max(1, width - visibleWidth(usedPrefix));
					const wrapped = wrapTextWithAnsi(remaining, available);
					const chunk = wrapped[0] ?? "";
					output.push(truncateToWidth(usedPrefix + chunk, width, "", true));
					remaining = wrapped.slice(1).join(" ");
					first = false;
				}
			}
		}
		return output;
	}
}
