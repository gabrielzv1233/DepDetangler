function charRank(char) {
    if (char === '_') return [0, 0];
    if (!/[A-Za-z0-9]/.test(char)) return [1, char.codePointAt(0)];
    if (/[0-9]/.test(char)) return [2, char.codePointAt(0)];
    return [3, char.toLowerCase().codePointAt(0), char.codePointAt(0)];
}

function compareLex(a, b) {
    const max = Math.min(a.length, b.length);

    for (let i = 0; i < max; i++) {
        const ar = charRank(a[i]);
        const br = charRank(b[i]);
        const size = Math.max(ar.length, br.length);

        for (let j = 0; j < size; j++) {
            const av = ar[j] ?? 0;
            const bv = br[j] ?? 0;
            if (av !== bv) return av - bv;
        }
    }

    return a.length - b.length;
}

function strictCompare(a, b) {
    if (a.length !== b.length) return b.length - a.length;
    return compareLex(a, b);
}

function sortStrict(values) {
    return [...values].sort(strictCompare);
}

module.exports = {
    compareLex,
    sortStrict,
    strictCompare,
};
