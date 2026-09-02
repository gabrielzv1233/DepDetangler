const { strictCompare } = require('./sort');

function stripInlineComment(text) {
    let quote = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if ((ch === '"' || ch === "'") && text[i - 1] !== '\\') {
            quote = quote === ch ? '' : (quote || ch);
            continue;
        }
        if (ch === '#' && !quote) return [text.slice(0, i).trimEnd(), text.slice(i).trim()];
    }
    return [text.trimEnd(), ''];
}

function splitCommaList(text) {
    const output = [];
    let current = '';
    let depth = 0;
    let quote = '';

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if ((ch === '"' || ch === "'") && text[i - 1] !== '\\') {
            quote = quote === ch ? '' : (quote || ch);
            current += ch;
            continue;
        }
        if (!quote) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;
            else if (ch === ',' && depth === 0) {
                if (current.trim()) output.push(current.trim());
                current = '';
                continue;
            }
        }
        current += ch;
    }
    if (current.trim()) output.push(current.trim());
    return output;
}

function importedBaseName(item) {
    return item.split(/\s+as\s+/i)[0].trim();
}

function sortImportedItems(moduleName, items) {
    const moduleLeaf = moduleName.replace(/^\.+/, '').split('.').filter(Boolean).pop() || moduleName.replace(/^\.+/, '');
    return [...items].sort((a, b) => {
        const an = importedBaseName(a);
        const bn = importedBaseName(b);
        const am = an.toLowerCase() === moduleLeaf.toLowerCase();
        const bm = bn.toLowerCase() === moduleLeaf.toLowerCase();
        if (am !== bm) return am ? -1 : 1;
        return strictCompare(an, bn);
    });
}

function parseSingleImport(line, startLine = 0) {
    const indent = line.match(/^\s*/)[0];
    const trimmed = line.trim();
    const [withoutComment, inlineComment] = stripInlineComment(trimmed);

    let match = withoutComment.match(/^import\s+(.+)$/);
    if (match) {
        const items = splitCommaList(match[1]);
        if (!items.length) return null;
        return {
            type: 'import',
            indent,
            items,
            inlineComment,
            original: line,
            startLine,
            endLine: startLine,
        };
    }

    match = withoutComment.match(/^from\s+([.A-Za-z_][.A-Za-z0-9_]*)\s+import\s+(.+)$/);
    if (!match) return null;
    const moduleName = match[1];
    const rhs = match[2].trim();
    if (rhs.startsWith('(') || rhs.endsWith('\\')) return null;
    const items = splitCommaList(rhs);
    if (!items.length) return null;
    return {
        type: 'from',
        indent,
        moduleName,
        items,
        inlineComment,
        multiline: false,
        original: line,
        startLine,
        endLine: startLine,
    };
}

function parseMultilineFrom(lines, startLine) {
    const first = lines[startLine];
    const indent = first.match(/^\s*/)[0];
    const firstTrimmed = first.trim();
    const match = firstTrimmed.match(/^from\s+([.A-Za-z_][.A-Za-z0-9_]*)\s+import\s*\((.*)$/);
    if (!match) return null;

    const moduleName = match[1];
    let content = match[2];
    let endLine = startLine;
    let depth = 1;
    let quote = '';

    function scan(text) {
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if ((ch === '"' || ch === "'") && text[i - 1] !== '\\') {
                quote = quote === ch ? '' : (quote || ch);
                continue;
            }
            if (quote) continue;
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
    }

    scan(content);
    while (depth > 0 && endLine + 1 < lines.length) {
        endLine++;
        content += `\n${lines[endLine]}`;
        scan(lines[endLine]);
    }
    if (depth !== 0) return null;

    const originalLines = lines.slice(startLine, endLine + 1);
    if (originalLines.some((line, index) => index > 0 && line.includes('#'))) {
        return {
            type: 'opaqueImport',
            indent,
            moduleName,
            originalLines,
            startLine,
            endLine,
        };
    }

    const joined = originalLines.join('\n');
    const openIndex = joined.indexOf('(');
    const closeIndex = joined.lastIndexOf(')');
    if (openIndex < 0 || closeIndex < openIndex) return null;
    const inner = joined.slice(openIndex + 1, closeIndex).replace(/\n/g, ' ');
    const items = splitCommaList(inner);
    if (!items.length) return null;

    const itemIndentMatch = originalLines.slice(1).find((line) => line.trim() && line.trim() !== ')')?.match(/^\s*/);
    const itemIndent = itemIndentMatch?.[0] || `${indent}    `;
    const closingLine = originalLines[originalLines.length - 1];
    const afterClose = closingLine.slice(closingLine.lastIndexOf(')') + 1).trim();

    return {
        type: 'from',
        indent,
        moduleName,
        items,
        inlineComment: afterClose.startsWith('#') ? afterClose : '',
        multiline: true,
        itemIndent,
        originalLines,
        startLine,
        endLine,
    };
}

function parseBackslashFrom(lines, startLine) {
    const first = lines[startLine];
    const indent = first.match(/^\s*/)[0];
    if (!/^\s*from\s+/.test(first) || !/\\\s*$/.test(first)) return null;

    const collected = [first.replace(/\\\s*$/, '')];
    let endLine = startLine;
    while (endLine + 1 < lines.length) {
        endLine++;
        const raw = lines[endLine];
        collected.push(raw.replace(/\\\s*$/, ''));
        if (!/\\\s*$/.test(raw)) break;
    }
    const joined = collected.map((line) => line.trim()).join(' ');
    const parsed = parseSingleImport(`${indent}${joined}`, startLine);
    if (!parsed || parsed.type !== 'from') return null;
    parsed.endLine = endLine;
    parsed.originalLines = lines.slice(startLine, endLine + 1);
    parsed.multiline = true;
    parsed.itemIndent = `${indent}    `;
    return parsed;
}

function parseStatements(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const parts = [];

    for (let i = 0; i < lines.length; i++) {
        const multiline = parseMultilineFrom(lines, i) || parseBackslashFrom(lines, i);
        if (multiline) {
            parts.push(multiline);
            i = multiline.endLine;
            continue;
        }

        const single = parseSingleImport(lines[i], i);
        if (single) parts.push(single);
        else parts.push({ type: 'other', text: lines[i], indent: lines[i].match(/^\s*/)[0], startLine: i, endLine: i });
    }

    return parts;
}

function sortPlainImportItems(items) {
    return [...items].sort((a, b) => strictCompare(a.trim(), b.trim()));
}

function expandImportStatement(statement) {
    if (statement.type !== 'import' || statement.items.length <= 1) return [statement];
    return sortPlainImportItems(statement.items).map((item, index) => ({
        ...statement,
        items: [item],
        inlineComment: index === 0 ? statement.inlineComment : '',
    }));
}

function renderStatement(statement, collapseMultiline) {
    if (statement.type === 'opaqueImport') return statement.originalLines.join('\n');

    if (statement.type === 'import') {
        const items = sortPlainImportItems(statement.items);
        return `${statement.indent}import ${items.join(', ')}${statement.inlineComment ? ` ${statement.inlineComment}` : ''}`;
    }

    const items = sortImportedItems(statement.moduleName, statement.items);
    if (!statement.multiline || collapseMultiline) {
        return `${statement.indent}from ${statement.moduleName} import ${items.join(', ')}${statement.inlineComment ? ` ${statement.inlineComment}` : ''}`;
    }

    const lines = [`${statement.indent}from ${statement.moduleName} import (`];
    for (const item of items) lines.push(`${statement.itemIndent}${item},`);
    lines.push(`${statement.indent})${statement.inlineComment ? ` ${statement.inlineComment}` : ''}`);
    return lines.join('\n');
}

function formatPythonSelection(text, options = {}) {
    const parts = parseStatements(text);
    const output = [];
    const recognizedImports = parts.filter((part) => part.type === 'import' || part.type === 'from' || part.type === 'opaqueImport');
    const standaloneMultiImport = recognizedImports.length === 1
        && recognizedImports[0].type === 'import'
        && recognizedImports[0].items.length > 1;
    const alwaysSeparateSingleLines = options.alwaysSeparateSingleLines !== false;
    let importBlock = [];

    function flush() {
        if (!importBlock.length) return;
        const expandMultiImports = options.expandMultiImports === true
            || (alwaysSeparateSingleLines && standaloneMultiImport);
        const expanded = expandMultiImports ? importBlock.flatMap(expandImportStatement) : importBlock;
        const collapseMultiline = options.collapseMultilineImports === true;
        const sortRendered = (statements) => [...statements].sort((a, b) => strictCompare(
            renderStatement(a, collapseMultiline),
            renderStatement(b, collapseMultiline),
        ));

        if (options.separateFromImports === true) {
            const fromImports = sortRendered(expanded.filter((statement) => statement.type === 'from' || statement.type === 'opaqueImport'));
            const plainImports = sortRendered(expanded.filter((statement) => statement.type === 'import'));
            output.push(...fromImports.map((statement) => renderStatement(statement, collapseMultiline)));
            if (fromImports.length && plainImports.length) output.push('');
            output.push(...plainImports.map((statement) => renderStatement(statement, collapseMultiline)));
        } else {
            const sorted = sortRendered(expanded);
            output.push(...sorted.map((statement) => renderStatement(statement, collapseMultiline)));
        }
        importBlock = [];
    }

    for (const part of parts) {
        if (part.type === 'import' || part.type === 'from' || part.type === 'opaqueImport') {
            if (importBlock.length && importBlock[0].indent !== part.indent) flush();
            importBlock.push(part);
            continue;
        }

        if (part.text.trim() === '' && importBlock.length) {
            if (!standaloneMultiImport) continue;
            flush();
            output.push(part.text);
            continue;
        }
        flush();
        output.push(part.text);
    }
    flush();

    const result = output.join('\n');
    return text.endsWith('\n') && !result.endsWith('\n') ? `${result}\n` : result;
}

module.exports = {
    formatPythonSelection,
    importedBaseName,
    parseStatements,
    sortImportedItems,
    sortPlainImportItems,
};
