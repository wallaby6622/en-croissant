/** Convert to actual RGB before checking uniqueness: different HSL values can render identically. */
function rgbColor(hue: number, dark: boolean): number {
    const lightness = dark ? 0.72 : 0.3;
    const amplitude = 0.65 * Math.min(lightness, 1 - lightness);
    const channel = (offset: number) => {
        const k = (offset + hue / 30) % 12;
        return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return (channel(0) << 16) | (channel(8) << 8) | channel(4);
}

/** Allocate across the entire tree, so folding, selection and window changes keep the same colors. */
export function branchColors(names: Iterable<string>, theme: "light" | "dark") {
    const colors = new Map<string, string>();
    const used = new Set<number>();
    // Sorting also makes independent board and detached views agree regardless of traversal order.
    for (const [index, name] of [...new Set(names)].sort().entries()) {
        // A golden-angle sequence spreads adjacent names around the color wheel without a fixed palette.
        let rgb = rgbColor((index * 137.50776405003785) % 360, theme === "dark");
        // Never reuse an RGB color when rounding or a large repertoire produces a collision.
        while (used.has(rgb)) rgb = (rgb + 1) & 0xffffff;
        used.add(rgb);
        colors.set(name, `#${rgb.toString(16).padStart(6, "0")}`);
    }
    return colors;
}
