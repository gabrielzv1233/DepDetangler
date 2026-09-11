const { strictCompare } = require('./sort');

function readTomlString(text, start) {
    const quote = text[start];
    const triple = text.startsWith(quote.repeat(3), start);
    let index = start + (triple ? 3 : 1);

    while (index < text.length) {
        if (quote === '"' && text[index] === '\\') {
            index += 2;
            continue;
        }

        if (text[index] !== quote) {
            index++;
            continue;
        }

        let runEnd = index + 1;
        while (runEnd < text.length && text[runEnd] === quote) runEnd++;
        const runLength = runEnd - index;
        if (triple && runLength >= 3) return runEnd;
        if (!triple) return index + 1;
        index = runEnd;
    }
    return -1;
}

function maskTomlNonCode(text) {
    const masked = text.split('');

    for (let index = 0; index < text.length;) {
        const char = text[index];
        if (char === '#') {
            while (index < text.length && text[index] !== '\n') {
                if (text[index] !== '\r') masked[index] = ' ';
                index++;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            const end = readTomlString(text, index);
            const stop = end < 0 ? text.length : end;
            while (index < stop) {
                if (text[index] !== '\n' && text[index] !== '\r') masked[index] = ' ';
                index++;
            }
            continue;
        }
        index++;
    }
    return masked.join('');
}

function tomlCommentOffsets(text) {
    const offsets = [];
    for (let index = 0; index < text.length;) {
        const char = text[index];
        if (char === '#') {
            offsets.push(index);
            while (index < text.length && text[index] !== '\n') index++;
            continue;
        }
        if (char === '"' || char === "'") {
            const end = readTomlString(text, index);
            index = end < 0 ? text.length : end;
            continue;
        }
        index++;
    }
    return offsets;
}

function tomlStringValue(raw) {
    if (raw.startsWith("'''")) return raw.slice(3, -3);
    if (raw.startsWith("'")) return raw.slice(1, -1);
    if (raw.startsWith('"""')) {
        const inner = raw.slice(3, -3);
        try { return JSON.parse(`"${inner.replace(/"/g, '\\"')}"`); } catch { return inner; }
    }
    try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
}

function findArrayEnd(text, openIndex) {
    let depth = 1;
    for (let index = openIndex + 1; index < text.length; index++) {
        const char = text[index];
        if (char === '#') {
            while (index + 1 < text.length && text[index + 1] !== '\n') index++;
            continue;
        }
        if (char === '"' || char === "'") {
            const end = readTomlString(text, index);
            if (end < 0) return -1;
            index = end - 1;
            continue;
        }
        if (char === '[') depth++;
        else if (char === ']' && --depth === 0) return index;
    }
    return -1;
}

function stringSpans(body) {
    const spans = [];
    for (let index = 0; index < body.length; index++) {
        const char = body[index];
        if (char === '#') {
            while (index + 1 < body.length && body[index + 1] !== '\n') index++;
            continue;
        }
        if (char !== '"' && char !== "'") continue;
        const end = readTomlString(body, index);
        if (end < 0) return [];
        const raw = body.slice(index, end);
        spans.push({ start: index, end, raw, value: tomlStringValue(raw) });
        index = end - 1;
    }
    return spans;
}

function lineInfo(body) {
    const lines = [];
    let start = 0;
    while (start < body.length) {
        const newline = body.indexOf('\n', start);
        const end = newline < 0 ? body.length : newline + 1;
        lines.push({ start, end, raw: body.slice(start, end) });
        start = end;
    }
    if (!body.length) lines.push({ start: 0, end: 0, raw: '' });
    return lines;
}

function formatArrayBody(body) {
    const spans = stringSpans(body);
    if (spans.length < 2) return body;

    const lines = lineInfo(body);
    const entries = [];
    const usedLines = new Set();
    let lineMode = body.includes('\n');

    for (const span of spans) {
        const lineIndex = lines.findIndex((line) => span.start >= line.start && span.start < line.end);
        if (lineIndex < 0 || usedLines.has(lineIndex) || span.end > lines[lineIndex].end) {
            lineMode = false;
            break;
        }

        const line = lines[lineIndex];
        const tokenStart = span.start - line.start;
        const tokenEnd = span.end - line.start;
        const eol = line.raw.endsWith('\n') ? (line.raw.endsWith('\r\n') ? '\r\n' : '\n') : '';
        const content = eol ? line.raw.slice(0, -eol.length) : line.raw;
        const prefix = content.slice(0, tokenStart);
        const suffix = content.slice(tokenEnd);
        const suffixMatch = suffix.match(/^[ \t]*(?:,)?([ \t]*)(#.*)?$/);
        if (!/^[ \t]*$/.test(prefix) || !suffixMatch) {
            lineMode = false;
            break;
        }

        usedLines.add(lineIndex);
        entries.push({
            lineIndex,
            prefix,
            eol,
            raw: span.raw,
            value: span.value,
            commentGap: suffixMatch[2] ? (suffixMatch[1] || ' ') : '',
            comment: suffixMatch[2] || '',
        });
    }

    if (lineMode && entries.length === spans.length) {
        const comments = tomlCommentOffsets(body);
        const commentsAreAttached = comments.every((offset) => {
            const lineIndex = lines.findIndex((line) => offset >= line.start && offset < line.end);
            const entry = entries.find((item) => item.lineIndex === lineIndex);
            if (!entry) return false;
            const span = spans.find((item) => item.start >= lines[lineIndex].start && item.start < lines[lineIndex].end);
            return span && offset >= span.end;
        });
        if (!commentsAreAttached) return body;

        const sorted = [...entries].sort((a, b) => strictCompare(a.value, b.value));
        const output = [...lines];
        const slots = entries.map((entry) => entry.lineIndex).sort((a, b) => a - b);
        for (let index = 0; index < slots.length; index++) {
            const slot = lines[slots[index]];
            const slotEntry = entries.find((entry) => entry.lineIndex === slots[index]);
            const item = sorted[index];
            output[slots[index]] = {
                ...slot,
                raw: `${slotEntry.prefix}${item.raw},${item.comment ? item.commentGap + item.comment : ''}${slotEntry.eol}`,
            };
        }
        return output.map((line) => line.raw).join('');
    }

    let cursor = 0;
    for (const span of spans) {
        if (!/^[\s,]*$/.test(body.slice(cursor, span.start))) return body;
        cursor = span.end;
    }
    if (!/^[\s,]*$/.test(body.slice(cursor))) return body;

    const sortedRaw = [...spans]
        .sort((a, b) => strictCompare(a.value, b.value))
        .map((span) => span.raw);
    let result = '';
    cursor = 0;
    for (let index = 0; index < spans.length; index++) {
        result += body.slice(cursor, spans[index].start) + sortedRaw[index];
        cursor = spans[index].end;
    }
    return result + body.slice(cursor);
}

function projectRanges(text, syntax = maskTomlNonCode(text)) {
    const headers = [];
    const headerPattern = /^[ \t]*\[(?!\[)([^\]\r\n]+)\][ \t]*$/gm;
    let match;
    while ((match = headerPattern.exec(syntax))) {
        headers.push({ name: match[1].trim(), start: match.index, end: headerPattern.lastIndex });
    }

    const ranges = [];
    if (headers.length) ranges.push({ start: 0, end: headers[0].start, dotted: true });
    else ranges.push({ start: 0, end: text.length, dotted: true });

    for (let index = 0; index < headers.length; index++) {
        if (headers[index].name !== 'project') continue;
        ranges.push({
            start: headers[index].end,
            end: headers[index + 1]?.start ?? text.length,
            dotted: false,
        });
    }
    return ranges;
}

function formatPyprojectDependencies(text) {
    const syntax = maskTomlNonCode(text);
    const replacements = [];
    for (const range of projectRanges(text, syntax)) {
        const section = syntax.slice(range.start, range.end);
        const pattern = range.dotted
            ? /^[ \t]*project[ \t]*\.[ \t]*dependencies[ \t]*=[ \t]*\[/gm
            : /^[ \t]*dependencies[ \t]*=[ \t]*\[/gm;
        let match;
        while ((match = pattern.exec(section))) {
            const openIndex = range.start + match.index + match[0].lastIndexOf('[');
            const closeIndex = findArrayEnd(text, openIndex);
            if (closeIndex < 0 || closeIndex >= range.end) continue;
            const body = text.slice(openIndex + 1, closeIndex);
            const formatted = formatArrayBody(body);
            if (formatted !== body) {
                replacements.push({ start: openIndex + 1, end: closeIndex, text: formatted });
            }
            pattern.lastIndex = closeIndex - range.start + 1;
        }
    }

    let output = text;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
    }
    return output;
}

module.exports = {
    formatPyprojectDependencies,
};
