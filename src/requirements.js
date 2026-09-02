const { strictCompare } = require('./sort');

function canonicalName(name) {
    return name.trim().toLowerCase().replace(/[._-]+/g, '-');
}

function canonicalExtra(name) {
    return name.trim().toLowerCase().replace(/[._-]+/g, '-');
}

function splitInlineComment(line) {
    const match = line.match(/^(.*?)(\s+#.*)$/);
    if (!match) return [line, ''];
    return [match[1].trimEnd(), match[2].trim()];
}

function splitMarker(remainder, isDirect) {
    if (isDirect) {
        const match = remainder.match(/^(.*?)(?:\s+;\s*)(.+)$/);
        return match ? [match[1].trim(), match[2].trim()] : [remainder.trim(), ''];
    }

    let quote = '';
    for (let i = 0; i < remainder.length; i++) {
        const ch = remainder[i];
        if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
            quote = quote ? '' : ch;
            continue;
        }
        if (ch === ';' && !quote) return [remainder.slice(0, i).trim(), remainder.slice(i + 1).trim()];
    }
    return [remainder.trim(), ''];
}

function parseRequirementLine(rawLine, lineNumber) {
    const [withoutComment, inlineComment] = splitInlineComment(rawLine.trim());
    const match = withoutComment.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*\[([^\]]*)\])?\s*(.*)$/);
    if (!match) return null;

    const name = match[1];
    const extras = match[2]
        ? match[2].split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    const remainder = match[3].trim();
    const isDirect = remainder.startsWith('@');
    const [source, marker] = splitMarker(remainder, isDirect);

    if (source && !isDirect && !/^(?:===|==|~=|!=|<=|>=|<|>)/.test(source)) return null;

    return {
        lineNumber,
        rawLine,
        name,
        canonical: canonicalName(name),
        extras,
        sourceType: isDirect ? 'url' : 'version',
        url: isDirect ? source.slice(1).trim() : '',
        versionSpec: isDirect ? '' : source.replace(/^\((.*)\)$/, '$1').trim(),
        marker,
        inlineComment,
        leadingComments: [],
        hadBare: extras.length === 0,
    };
}

function parseLogicalLines(text) {
    const physical = text.replace(/\r\n/g, '\n').split('\n');
    const lines = [];

    for (let i = 0; i < physical.length; i++) {
        let raw = physical[i];
        const startLine = i;
        while (/\\\s*$/.test(raw) && i + 1 < physical.length) {
            raw = raw.replace(/\\\s*$/, '').trimEnd() + ' ' + physical[++i].trim();
        }
        lines.push({ raw, lineNumber: startLine });
    }

    return lines;
}

function parseRequirements(text) {
    const requirements = [];
    const opaque = [];
    let pendingComments = [];

    for (const { raw, lineNumber } of parseLogicalLines(text)) {
        const trimmed = raw.trim();
        if (!trimmed) {
            if (pendingComments.length) {
                opaque.push(...pendingComments);
                pendingComments = [];
            }
            continue;
        }

        if (trimmed.startsWith('#')) {
            pendingComments.push(trimmed);
            continue;
        }

        if (trimmed.startsWith('-')) {
            if (pendingComments.length) {
                opaque.push(...pendingComments);
                pendingComments = [];
            }
            opaque.push(raw.trimEnd());
            continue;
        }

        const parsed = parseRequirementLine(raw, lineNumber);
        if (!parsed) {
            if (pendingComments.length) {
                opaque.push(...pendingComments);
                pendingComments = [];
            }
            opaque.push(raw.trimEnd());
            continue;
        }

        parsed.leadingComments = pendingComments;
        pendingComments = [];
        requirements.push(parsed);
    }

    if (pendingComments.length) opaque.push(...pendingComments);
    return { requirements, opaque };
}

function extractProjectNames(text) {
    const { requirements } = parseRequirements(text);
    return [...new Set(requirements.map((req) => req.canonical))];
}

function normalizeReleaseParts(parts) {
    const result = parts.map((value) => Number(value));
    while (result.length > 1 && result[result.length - 1] === 0) result.pop();
    return result;
}

function parseVersion(version) {
    const original = version.trim();
    const match = original.match(/^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:(?:[._-]?)(a|b|rc|alpha|beta|c|pre|preview)(?:[._-]?(\d+))?)?(?:(?:[._-]?)(?:post|rev|r)(?:[._-]?(\d+))?)?(?:(?:[._-]?)dev(?:[._-]?(\d+))?)?(?:\+(.+))?$/i);

    if (!match) {
        const tokens = original.toLowerCase().split(/([0-9]+)/).filter(Boolean).map((token) => /^\d+$/.test(token) ? Number(token) : token);
        return { original, fallback: true, tokens };
    }

    const preMap = { a: 0, alpha: 0, b: 1, beta: 1, rc: 2, c: 2, pre: 2, preview: 2 };
    const preLabel = match[3]?.toLowerCase();
    return {
        original,
        fallback: false,
        epoch: Number(match[1] || 0),
        release: normalizeReleaseParts(match[2].split('.')),
        releaseSpecified: match[2].split('.').map((value) => Number(value)),
        preRank: preLabel ? preMap[preLabel] : null,
        preNumber: Number(match[4] || 0),
        postNumber: match[5] === undefined ? null : Number(match[5] || 0),
        devNumber: match[6] === undefined ? null : Number(match[6] || 0),
        local: match[7]?.toLowerCase().split(/[._-]/).map((token) => /^\d+$/.test(token) ? Number(token) : token) || null,
    };
}

function compareTokenArrays(a, b) {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av === bv) continue;
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        if (typeof av === 'number') return 1;
        if (typeof bv === 'number') return -1;
        return String(av).localeCompare(String(bv));
    }
    return 0;
}

function compareVersions(a, b) {
    const av = typeof a === 'string' ? parseVersion(a) : a;
    const bv = typeof b === 'string' ? parseVersion(b) : b;

    if (av.fallback || bv.fallback) {
        const at = av.fallback ? av.tokens : av.original.toLowerCase().split(/([0-9]+)/).filter(Boolean).map((token) => /^\d+$/.test(token) ? Number(token) : token);
        const bt = bv.fallback ? bv.tokens : bv.original.toLowerCase().split(/([0-9]+)/).filter(Boolean).map((token) => /^\d+$/.test(token) ? Number(token) : token);
        return compareTokenArrays(at, bt);
    }

    if (av.epoch !== bv.epoch) return av.epoch - bv.epoch;
    const release = compareTokenArrays(av.release, bv.release);
    if (release) return release;

    const aStage = av.preRank !== null ? av.preRank : (av.devNumber !== null ? -1 : 3);
    const bStage = bv.preRank !== null ? bv.preRank : (bv.devNumber !== null ? -1 : 3);
    if (aStage !== bStage) return aStage - bStage;
    if (av.preRank !== null && av.preNumber !== bv.preNumber) return av.preNumber - bv.preNumber;

    if (av.devNumber !== null || bv.devNumber !== null) {
        if (av.devNumber === null) return 1;
        if (bv.devNumber === null) return -1;
        if (av.devNumber !== bv.devNumber) return av.devNumber - bv.devNumber;
    }

    if (av.postNumber !== null || bv.postNumber !== null) {
        if (av.postNumber === null) return -1;
        if (bv.postNumber === null) return 1;
        if (av.postNumber !== bv.postNumber) return av.postNumber - bv.postNumber;
    }

    if (av.local || bv.local) {
        if (!av.local) return -1;
        if (!bv.local) return 1;
        return compareTokenArrays(av.local, bv.local);
    }
    return 0;
}

function compatibleUpper(version) {
    const parsed = parseVersion(version);
    if (parsed.fallback || parsed.release.length < 2) return null;
    const release = [...(parsed.releaseSpecified || parsed.release)];
    const keep = release.length - 1;
    const prefix = release.slice(0, keep);
    prefix[prefix.length - 1] += 1;
    return prefix.join('.');
}

function wildcardBounds(version) {
    const clean = version.replace(/\.\*$/, '');
    const parts = clean.split('.');
    if (!parts.every((part) => /^\d+$/.test(part))) return null;
    const upper = parts.map(Number);
    upper[upper.length - 1] += 1;
    return { lower: clean, upper: upper.join('.') };
}

function parseSpecifier(spec) {
    const match = spec.trim().match(/^(===|==|~=|!=|<=|>=|<|>)\s*(.+)$/);
    return match ? { op: match[1], version: match[2].trim(), raw: spec.trim() } : null;
}

function satisfiesBound(version, bound, lower) {
    if (!bound) return true;
    const cmp = compareVersions(version, bound.version);
    return lower ? (bound.inclusive ? cmp >= 0 : cmp > 0) : (bound.inclusive ? cmp <= 0 : cmp < 0);
}

function chooseLower(current, candidate) {
    if (!current) return candidate;
    const cmp = compareVersions(candidate.version, current.version);
    if (cmp > 0) return candidate;
    if (cmp < 0) return current;
    if (!candidate.inclusive && current.inclusive) return candidate;
    return current;
}

function chooseUpper(current, candidate) {
    if (!current) return candidate;
    const cmp = compareVersions(candidate.version, current.version);
    if (cmp < 0) return candidate;
    if (cmp > 0) return current;
    if (!candidate.inclusive && current.inclusive) return candidate;
    return current;
}

function resolveVersionSpecs(specs) {
    const cleaned = specs.map((value) => value.trim()).filter(Boolean);
    if (!cleaned.length) return { spec: '', conflict: false, messages: [] };

    const exacts = [];
    const exclusions = [];
    const passthrough = [];
    const mentions = [];
    let lower = null;
    let upper = null;
    let conflict = false;
    const messages = [];

    for (const group of cleaned) {
        const parts = group.replace(/^\((.*)\)$/, '$1').split(',').map((part) => part.trim()).filter(Boolean);
        for (const part of parts) {
            const parsed = parseSpecifier(part);
            if (!parsed) {
                passthrough.push(part);
                continue;
            }
            mentions.push(parsed);

            if ((parsed.op === '==' || parsed.op === '===') && !parsed.version.endsWith('.*')) {
                exacts.push(parsed);
                continue;
            }

            if (parsed.op === '==' && parsed.version.endsWith('.*')) {
                const bounds = wildcardBounds(parsed.version);
                if (!bounds) passthrough.push(part);
                else {
                    lower = chooseLower(lower, { version: bounds.lower, inclusive: true, source: parsed });
                    upper = chooseUpper(upper, { version: bounds.upper, inclusive: false, source: parsed });
                }
                continue;
            }

            if (parsed.op === '~=') {
                const compatUpper = compatibleUpper(parsed.version);
                lower = chooseLower(lower, { version: parsed.version, inclusive: true, source: parsed });
                if (compatUpper) upper = chooseUpper(upper, { version: compatUpper, inclusive: false, source: parsed });
                else passthrough.push(part);
                continue;
            }

            if (parsed.op === '>=') lower = chooseLower(lower, { version: parsed.version, inclusive: true, source: parsed });
            else if (parsed.op === '>') lower = chooseLower(lower, { version: parsed.version, inclusive: false, source: parsed });
            else if (parsed.op === '<=') upper = chooseUpper(upper, { version: parsed.version, inclusive: true, source: parsed });
            else if (parsed.op === '<') upper = chooseUpper(upper, { version: parsed.version, inclusive: false, source: parsed });
            else if (parsed.op === '!=') exclusions.push(parsed);
        }
    }

    if (exacts.length) {
        const sorted = [...exacts].sort((a, b) => compareVersions(b.version, a.version));
        const chosen = sorted[0];
        if (sorted.some((item) => compareVersions(item.version, chosen.version) !== 0)) {
            conflict = true;
            messages.push(`Conflicting exact versions were found; using the highest exact version ${chosen.version}.`);
        }
        if (!satisfiesBound(chosen.version, lower, true) || !satisfiesBound(chosen.version, upper, false) || exclusions.some((item) => compareVersions(item.version, chosen.version) === 0)) {
            conflict = true;
            messages.push(`Exact version ${chosen.version} conflicts with another constraint; exact versions take priority.`);
        }
        return { spec: `==${chosen.version}`, conflict, messages };
    }

    if (lower && upper) {
        const cmp = compareVersions(lower.version, upper.version);
        if (cmp > 0 || (cmp === 0 && (!lower.inclusive || !upper.inclusive))) {
            conflict = true;
            messages.push(`The minimum version ${lower.version} is newer than the maximum compatible version ${upper.version}; using the newest lower-bound constraint.`);
            return { spec: `${lower.inclusive ? '>=' : '>'}${lower.version}`, conflict, messages };
        }
    }

    const resolved = [];
    if (lower) resolved.push(`${lower.inclusive ? '>=' : '>'}${lower.version}`);
    if (upper) resolved.push(`${upper.inclusive ? '<=' : '<'}${upper.version}`);

    const uniqueExclusions = new Map();
    for (const item of exclusions) uniqueExclusions.set(`${item.op}${item.version}`, item);
    const sortedExclusions = [...uniqueExclusions.values()].sort((a, b) => compareVersions(b.version, a.version));
    resolved.push(...sortedExclusions.map((item) => `!=${item.version}`));
    resolved.push(...[...new Set(passthrough)]);

    return { spec: resolved.join(','), conflict, messages };
}

function metadataExtraMap(metadata) {
    const map = new Map();
    if (!metadata?.extras) return map;
    for (const extra of metadata.extras) map.set(canonicalExtra(extra), extra);
    return map;
}

function preferredName(reqs, metadata, lookupModules) {
    if (lookupModules) return metadata?.name || reqs[0].canonical;
    return reqs[0].name.toLowerCase();
}

function preferredExtra(extra, metadata, lookupExtras, normalizeExtras) {
    const key = canonicalExtra(extra);
    if (lookupExtras) {
        const match = metadataExtraMap(metadata).get(key);
        if (match) return match;
        if (normalizeExtras) return key;
    }
    return normalizeExtras ? key : extra;
}

function mergeComments(entries) {
    const leading = [];
    const seen = new Set();
    let inlineComment = '';

    for (const entry of entries) {
        for (const comment of entry.leadingComments || []) {
            if (!seen.has(comment)) {
                seen.add(comment);
                leading.push(comment);
            }
        }
        if (entry.inlineComment) {
            if (!inlineComment) inlineComment = entry.inlineComment;
            else if (entry.inlineComment !== inlineComment && !seen.has(entry.inlineComment)) {
                seen.add(entry.inlineComment);
                leading.push(entry.inlineComment);
            }
        }
    }
    return { leadingComments: leading, inlineComment };
}

function renderRequirement(entry) {
    const extras = entry.extras.length ? `[${entry.extras.join(',')}]` : '';
    const source = entry.sourceType === 'url'
        ? ` @ ${entry.url}`
        : entry.versionSpec;
    const marker = entry.marker ? `; ${entry.marker}` : '';
    const comment = entry.inlineComment ? ` ${entry.inlineComment}` : '';
    return `${entry.name}${extras}${source}${marker}${comment}`;
}

function baseRequirementKey(entry) {
    return `${entry.canonical}\0${entry.marker}\0${entry.sourceType}\0${entry.sourceType === 'url' ? entry.url : ''}`;
}

function processBucket(reqs, options, metadata, diagnostics) {
    const lookup = options.pypiNameLookup || 'both';
    const lookupModules = lookup === 'both' || lookup === 'modules';
    const lookupExtras = lookup === 'both' || lookup === 'extras';
    const normalizeExtras = options.normalizeExtras !== false;
    const name = preferredName(reqs, metadata, lookupModules);
    const comments = mergeComments(reqs);
    const sourceType = reqs[0].sourceType;
    const marker = reqs[0].marker;
    const url = reqs[0].url;
    const resolution = sourceType === 'version'
        ? resolveVersionSpecs(reqs.map((req) => req.versionSpec))
        : { spec: '', conflict: false, messages: [] };

    if (resolution.conflict) {
        for (const message of resolution.messages) diagnostics.push({ package: name, message });
    }

    const allExtras = [];
    const extraSeen = new Set();
    for (const req of reqs) {
        for (const extra of req.extras) {
            const key = canonicalExtra(extra);
            if (!extraSeen.has(key)) {
                extraSeen.add(key);
                allExtras.push(preferredExtra(extra, metadata, lookupExtras, normalizeExtras));
            }
        }
    }
    allExtras.sort(strictCompare);

    const common = {
        canonical: reqs[0].canonical,
        name,
        sourceType,
        url,
        versionSpec: resolution.spec,
        marker,
        ...comments,
    };

    if (options.extraMode === 'preserve') {
        const byExtras = new Map();
        for (const req of reqs) {
            const extras = req.extras
                .map((extra) => preferredExtra(extra, metadata, lookupExtras, normalizeExtras))
                .sort(strictCompare);
            const key = extras.map(canonicalExtra).sort().join(',');
            const existing = byExtras.get(key);
            if (existing) {
                const merged = mergeComments([existing, req]);
                existing.leadingComments = merged.leadingComments;
                existing.inlineComment = merged.inlineComment;
            } else {
                byExtras.set(key, { ...common, extras, leadingComments: [...req.leadingComments], inlineComment: req.inlineComment });
            }
        }
        return [...byExtras.values()];
    }

    if (options.extraMode === 'individual') {
        const output = [];
        const hadBare = reqs.some((req) => req.extras.length === 0);
        if (hadBare) output.push({ ...common, extras: [] });
        for (const extra of allExtras) output.push({ ...common, extras: [extra], leadingComments: [], inlineComment: '' });
        if (!output.length) output.push({ ...common, extras: [] });
        return output;
    }

    return [{ ...common, extras: allExtras }];
}

function cleanDuplicates(entries) {
    const output = [];
    const seen = new Map();

    for (const entry of entries) {
        const key = [
            entry.canonical,
            entry.extras.map(canonicalExtra).sort().join(','),
            entry.sourceType,
            entry.sourceType === 'url' ? entry.url : entry.versionSpec,
            entry.marker,
        ].join('\0');
        if (!seen.has(key)) {
            seen.set(key, entry);
            output.push(entry);
            continue;
        }
        const existing = seen.get(key);
        const merged = mergeComments([existing, entry]);
        existing.leadingComments = merged.leadingComments;
        existing.inlineComment = merged.inlineComment;
    }
    return output;
}

function formatRequirements(text, options = {}, metadataByCanonical = new Map()) {
    const parsed = parseRequirements(text);
    const diagnostics = [];
    const buckets = new Map();

    for (const req of parsed.requirements) {
        const key = baseRequirementKey(req);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(req);
    }

    const packageSources = new Map();
    for (const req of parsed.requirements) {
        const key = `${req.canonical}\0${req.marker}`;
        if (!packageSources.has(key)) packageSources.set(key, new Set());
        packageSources.get(key).add(req.sourceType === 'url' ? `url:${req.url}` : 'index');
    }
    for (const [key, sources] of packageSources) {
        if (sources.size > 1) {
            const packageName = key.split('\0')[0];
            diagnostics.push({ package: packageName, message: 'This package is declared from multiple sources (index/version and/or direct URLs). The formatter preserved each source instead of guessing which one should win.' });
        }
    }

    let entries = [];
    for (const reqs of buckets.values()) {
        entries.push(...processBucket(
            reqs,
            {
                extraMode: options.extraMode || 'merge',
                normalizeExtras: options.normalizeExtras !== false,
                pypiNameLookup: options.pypiNameLookup || 'both',
            },
            metadataByCanonical.get(reqs[0].canonical),
            diagnostics,
        ));
    }

    entries = cleanDuplicates(entries);
    const opaque = parsed.opaque.filter((line) => line.trim());
    const blocks = [];

    if ((options.extraMode || 'merge') === 'individual') {
        const extrasPerPackage = new Map();
        for (const entry of entries) {
            if (!extrasPerPackage.has(entry.canonical)) extrasPerPackage.set(entry.canonical, new Set());
            for (const extra of entry.extras) extrasPerPackage.get(entry.canonical).add(canonicalExtra(extra));
        }

        const groupedNames = [...extrasPerPackage.entries()]
            .filter(([, extras]) => extras.size > 1)
            .map(([name]) => name)
            .sort((a, b) => {
                const an = entries.find((entry) => entry.canonical === a)?.name || a;
                const bn = entries.find((entry) => entry.canonical === b)?.name || b;
                return strictCompare(an, bn);
            });
        const groupedSet = new Set(groupedNames);

        for (const packageName of groupedNames) {
            const group = entries.filter((entry) => entry.canonical === packageName).sort((a, b) => strictCompare(renderRequirement(a), renderRequirement(b)));
            blocks.push(group);
        }

        const ungrouped = entries.filter((entry) => !groupedSet.has(entry.canonical)).sort((a, b) => strictCompare(renderRequirement(a), renderRequirement(b)));
        if (ungrouped.length) blocks.push(ungrouped);
    } else {
        blocks.push(entries.sort((a, b) => strictCompare(renderRequirement(a), renderRequirement(b))));
    }

    const renderedBlocks = blocks.filter((block) => block.length).map((block) => block.flatMap((entry) => [
        ...(entry.leadingComments || []),
        renderRequirement(entry),
    ]).join('\n'));

    const parts = [];
    if (opaque.length) parts.push(opaque.join('\n'));
    if (renderedBlocks.length) parts.push(renderedBlocks.join((options.extraMode || 'merge') === 'individual' ? '\n\n' : '\n'));

    return {
        text: parts.join(parts.length > 1 ? '\n' : '').replace(/\n+$/, '') + (text.endsWith('\n') ? '\n' : ''),
        diagnostics,
    };
}

module.exports = {
    canonicalExtra,
    canonicalName,
    compareVersions,
    extractProjectNames,
    formatRequirements,
    parseRequirementLine,
    parseRequirements,
    renderRequirement,
    resolveVersionSpecs,
};
