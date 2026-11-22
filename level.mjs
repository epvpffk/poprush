export const MAX_LEVEL = 200;
export const XP_SCORE_DIVISOR = 500;
export function xpNeeded(level) {
    const value = Math.max(1, Math.min(MAX_LEVEL - 1, Math.floor(level))) - 1;
    return 500 + value * 100 + Math.floor(value * value * 2.5);
}
export function totalXpForLevel(level) {
    let total = 0, target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    for (let current = 1; current < target; current++)
        total += xpNeeded(current);
    return total;
}
export const MAX_XP = totalXpForLevel(MAX_LEVEL);
export function progressFromXp(value) {
    const totalXp = Math.max(0, Math.min(MAX_XP, Math.floor(Number(value) || 0)));
    let level = 1, base = 0;
    while (level < MAX_LEVEL) {
        let needed = xpNeeded(level);
        if (totalXp < base + needed)
            break;
        base += needed;
        level++;
    }
    const atMax = level === MAX_LEVEL, currentXp = atMax ? 0 : totalXp - base, nextXp = atMax ? 0 : xpNeeded(level);
    return {
        level,
        totalXp,
        currentXp,
        nextXp,
        percent: atMax
            ? 100
            : Math.max(0, Math.min(100, Math.floor((currentXp / nextXp) * 100))),
        tier: Math.min(19, Math.floor(level / 10)),
        atMax,
    };
}
export function xpFromBlockScore(score) {
    return Math.max(0, Math.floor((Number(score) || 0) / XP_SCORE_DIVISOR));
}
export const LEVEL_COLORS = [
    "#6f7892",
    "#4287a8",
    "#2f9f8f",
    "#4aa65a",
    "#85a33c",
    "#b59b36",
    "#c5873f",
    "#d26d4e",
    "#d05268",
    "#c44788",
    "#a94ca3",
    "#865bb7",
    "#666bc8",
    "#4c7ed1",
    "#398fbf",
    "#2e9eaa",
    "#35a18a",
    "#5a9e66",
    "#8c9149",
    "#b87a45",
];
export function levelColor(level) {
    return LEVEL_COLORS[Math.max(0, Math.min(LEVEL_COLORS.length - 1, Math.floor(Math.max(1, level) / 10)))];
}
