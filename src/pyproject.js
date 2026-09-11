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

function decodeTomlBasicString(inner, multiline = false) {
    let value = '';
    let index = 0;

    while (index < inner.length) {
        if (inner[index] !== '\\') {
            value += inner[index++];
            continue;
        }

        let next = index + 1;
        if (multiline) {
            while (next < inner.length && (inner[next] === ' ' || inner[next] === '\t')) next++;
            if (inner[next] === '\n' || (inner[next] === '\r' && inner[next + 1] === '\n')) {
                next += inner[next] === '\r' ? 2 : 1;
                while (next < inner.length && /[ \t\r\n]/.test(inner[next])) next++;
                index = next;
                continue;
            }
        }

        const escape = inner[index + 1];
        const simple = {
            b: '\b',
            t: '\t',
            n: '\n',
            f: '\f',
            r: '\r',
            '"': '"',
            '\\': '\\',
        };
        if (Object.hasOwn(simple, escape)) {
            value += simple[escape];
            index += 2;
            continue;
        }

        if (escape === 'u' || escape === 'U') {
            const size = escape === 'u' ? 4 : 8;
            const hex = inner.slice(index + 2, index + 2 + size);
            if (hex.length !== size || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
            const codePoint = Number.parseInt(hex, 16);
            if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return null;
            value += String.fromCodePoint(codePoint);
            index += size + 2;
            continue;
        }

        return null;
    }
    return value;
}

function tomlStringValue(raw) {
    const tripleLiteral = raw.startsWith("'''");
    const tripleBasic = raw.startsWith('"""');
    const triple = tripleLiteral || tripleBasic;
    const delimiterLength = triple ? 3 : 1;
    let inner = raw.slice(delimiterLength, -delimiterLength);

    if (triple) {
        if (inner.startsWith('\r\n')) inner = inner.slice(2);
        else if (inner.startsWith('\n')) inner = inner.slice(1);
    }

    if (tripleLiteral || raw.startsWith("'")) return inner;
    return decodeTomlBasicString(inner, tripleBasic);
}

function parseTomlKeySegment(text, start) {
    let index = start;
    while (index < text.length && /[ \t]/.test(text[index])) index++;
    if (index >= text.length) return null;

    if (text[index] === '"' || text[index] === "'") {
        if (text.startsWith(text[index].repeat(3), index)) return null;
        const end = readTomlString(text, index);
        if (end < 0 || text.slice(index, end).includes('\n')) return null;
        const value = tomlStringValue(text.slice(index, end));
        if (value === null) return null;
        return { value, end };
    }

    const match = text.slice(index).match(/^[A-Za-z0-9_-]+/);
    if (!match) return null;
    return { value: match[0], end: index + match[0].length };
}

function parseTomlKeyPath(text, start = 0) {
    const segments = [];
    let index = start;

    while (true) {
        const segment = parseTomlKeySegment(text, index);
        if (!segment) return null;
        segments.push(segment.value);
        index = segment.end;
        while (index < text.length && /[ \t]/.test(text[index])) index++;
        if (text[index] !== '.') return { segments, end: index };
        index++;
    }
}

function lineInfo(text) {
    const lines = [];
    let start = 0;
    while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const end = newline < 0 ? text.length : newline + 1;
        lines.push({ start, end, raw: text.slice(start, end) });
        start = end;
    }
    if (!text.length) lines.push({ start: 0, end: 0, raw: '' });
    return lines;
}

function documentStringSpans(text) {
    const spans = [];
    for (let index = 0; index < text.length;) {
        if (text[index] === '#') {
            while (index < text.length && text[index] !== '\n') index++;
            continue;
        }
        if (text[index] === '"' || text[index] === "'") {
            const end = readTomlString(text, index);
            const stop = end < 0 ? text.length : end;
            spans.push({ start: index, end: stop });
            index = stop;
            continue;
        }
        index++;
    }
    return spans;
}

function lineStartsInsideString(lineStart, spans) {
    return spans.some((span) => span.start < lineStart && span.end > lineStart);
}

function parseTableHeader(line) {
    let index = 0;
    while (index < line.length && /[ \t]/.test(line[index])) index++;
    if (line[index] !== '[') return null;

    const arrayTable = line[index + 1] === '[';
    index += arrayTable ? 2 : 1;
    const path = parseTomlKeyPath(line, index);
    if (!path) return null;
    index = path.end;
    while (index < line.length && /[ \t]/.test(line[index])) index++;

    if (arrayTable) {
        if (line.slice(index, index + 2) !== ']]') return null;
        index += 2;
    } else {
        if (line[index] !== ']') return null;
        index++;
    }

    while (index < line.length && /[ \t]/.test(line[index])) index++;
    if (line[index] === '#') return { segments: path.segments, arrayTable };
    if (index !== line.length) return null;
    return { segments: path.segments, arrayTable };
}

function parseArrayAssignment(line) {
    let index = 0;
    while (index < line.length && /[ \t]/.test(line[index])) index++;
    const path = parseTomlKeyPath(line, index);
    if (!path) return null;
    index = path.end;
    while (index < line.length && /[ \t]/.test(line[index])) index++;
    if (line[index] !== '=') return null;
    index++;
    while (index < line.length && /[ \t]/.test(line[index])) index++;
    if (line[index] !== '[') return null;
    return { segments: path.segments, openIndex: index };
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
        const value = tomlStringValue(raw);
        if (value === null) return [];
        spans.push({ start: index, end, raw, value });
        index = end - 1;
    }
    return spans;
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

function projectRanges(text, lines, spans) {
    const headers = [];
    for (const line of lines) {
        if (lineStartsInsideString(line.start, spans)) continue;
        const raw = line.raw.replace(/\r?\n$/, '');
        const header = parseTableHeader(raw);
        if (!header) continue;
        headers.push({
            ...header,
            start: line.start,
            end: line.end,
        });
    }

    const ranges = [];
    if (headers.length) ranges.push({ start: 0, end: headers[0].start, dotted: true });
    else ranges.push({ start: 0, end: text.length, dotted: true });

    for (let index = 0; index < headers.length; index++) {
        const header = headers[index];
        if (header.arrayTable || header.segments.length !== 1 || header.segments[0] !== 'project') continue;
        ranges.push({
            start: header.end,
            end: headers[index + 1]?.start ?? text.length,
            dotted: false,
        });
    }
    return ranges;
}

function formatPyprojectDependencies(text) {
    const lines = lineInfo(text);
    const documentSpans = documentStringSpans(text);
    const replacements = [];

    for (const range of projectRanges(text, lines, documentSpans)) {
        for (const line of lines) {
            if (line.start < range.start || line.start >= range.end) continue;
            if (lineStartsInsideString(line.start, documentSpans)) continue;

            const raw = line.raw.replace(/\r?\n$/, '');
            const assignment = parseArrayAssignment(raw);
            if (!assignment) continue;
            const wanted = range.dotted
                ? assignment.segments.length === 2
                    && assignment.segments[0] === 'project'
                    && assignment.segments[1] === 'dependencies'
                : assignment.segments.length === 1 && assignment.segments[0] === 'dependencies';
            if (!wanted) continue;

            const openIndex = line.start + assignment.openIndex;
            const closeIndex = findArrayEnd(text, openIndex);
            if (closeIndex < 0 || closeIndex >= range.end) continue;
            const body = text.slice(openIndex + 1, closeIndex);
            const formatted = formatArrayBody(body);
            if (formatted !== body) {
                replacements.push({ start: openIndex + 1, end: closeIndex, text: formatted });
            }
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
