const assert = require('assert');
const { formatPyprojectDependencies } = require('../src/pyproject');

function eq(actual, expected, label) {
    try {
        assert.strictEqual(actual, expected);
        console.log(`PASS ${label}`);
    } catch (error) {
        console.error(`FAIL ${label}`);
        console.error('EXPECTED:\n' + expected);
        console.error('ACTUAL:\n' + actual);
        throw error;
    }
}

eq(
    formatPyprojectDependencies([
        '[project]',
        'name = "demo"',
        'dependencies = [',
        '    "httpx>=0.27",',
        '    "openai-whisper>=20231117",',
        '    "fastapi>=0.111",',
        ']',
    ].join('\n')),
    [
        '[project]',
        'name = "demo"',
        'dependencies = [',
        '    "openai-whisper>=20231117",',
        '    "fastapi>=0.111",',
        '    "httpx>=0.27",',
        ']',
    ].join('\n'),
    'multiline project dependencies use strict dependency ordering',
);

eq(
    formatPyprojectDependencies('[project]\ndependencies = ["httpx>=0.27", "openai-whisper>=20231117", "fastapi>=0.111"]\n'),
    '[project]\ndependencies = ["openai-whisper>=20231117", "fastapi>=0.111", "httpx>=0.27"]\n',
    'inline project dependencies are sorted in place',
);

eq(
    formatPyprojectDependencies('project.dependencies = ["a", "bbbb", "cc"]\n'),
    'project.dependencies = ["bbbb", "cc", "a"]\n',
    'root dotted project.dependencies is supported',
);

eq(
    formatPyprojectDependencies([
        '[project]',
        'dependencies = [',
        '    "httpx>=0.27", # HTTP client',
        '    "openai-whisper>=20231117", # transcription',
        '    "fastapi>=0.111" # API',
        ']',
    ].join('\n')),
    [
        '[project]',
        'dependencies = [',
        '    "openai-whisper>=20231117", # transcription',
        '    "fastapi>=0.111", # API',
        '    "httpx>=0.27", # HTTP client',
        ']',
    ].join('\n'),
    'dependency comments move with their dependency',
);

const toolSection = [
    '[tool.example]',
    'dependencies = ["short", "much-longer"]',
].join('\n');
eq(formatPyprojectDependencies(toolSection), toolSection, 'tool dependencies are left untouched');

const multilineStringInput = [
    'summary = """',
    '[project]',
    'dependencies = ["inside-long", "x"]',
    '"""',
    '[project]',
    'description = """',
    'dependencies = ["inside-long", "x"]',
    '"""',
    'dependencies = ["a", "bbbb"]',
].join('\n');
const multilineStringExpected = [
    'summary = """',
    '[project]',
    'dependencies = ["inside-long", "x"]',
    '"""',
    '[project]',
    'description = """',
    'dependencies = ["inside-long", "x"]',
    '"""',
    'dependencies = ["bbbb", "a"]',
].join('\n');
eq(
    formatPyprojectDependencies(multilineStringInput),
    multilineStringExpected,
    'table headers and dependency keys inside multiline strings are ignored',
);

const mixedCommentLayout = [
    '[project]',
    'dependencies = ["httpx", # HTTP client',
    '    "openai-whisper", "fastapi"]',
].join('\n');
eq(
    formatPyprojectDependencies(mixedCommentLayout),
    mixedCommentLayout,
    'ambiguous mixed-line comments are left untouched',
);

const leadingCommentLayout = [
    '[project]',
    'dependencies = [',
    '    # HTTP client',
    '    "httpx",',
    '    "openai-whisper",',
    ']',
].join('\n');
eq(
    formatPyprojectDependencies(leadingCommentLayout),
    leadingCommentLayout,
    'standalone dependency comments are left untouched',
);

eq(
    formatPyprojectDependencies([
        "['project']",
        "'dependencies' = [\"a\", \"bbbb\"]",
    ].join('\n')),
    [
        "['project']",
        "'dependencies' = [\"bbbb\", \"a\"]",
    ].join('\n'),
    'single-quoted project table and dependencies key are recognized',
);

eq(
    formatPyprojectDependencies([
        '["project"]',
        '"dependencies" = ["a", "bbbb"]',
    ].join('\n')),
    [
        '["project"]',
        '"dependencies" = ["bbbb", "a"]',
    ].join('\n'),
    'double-quoted project table and dependencies key are recognized',
);

eq(
    formatPyprojectDependencies('project."dependencies" = ["a", "bbbb"]\n'),
    'project."dependencies" = ["bbbb", "a"]\n',
    'quoted dependencies segment in root dotted key is recognized',
);

eq(
    formatPyprojectDependencies('"project".\'dependencies\' = ["a", "bbbb"]\n'),
    '"project".\'dependencies\' = ["bbbb", "a"]\n',
    'fully quoted root dotted key is recognized',
);

const slash = String.fromCharCode(92);
const escapedProjectHeader = `["pro${slash}u006Aect"]`;
eq(
    formatPyprojectDependencies([
        escapedProjectHeader,
        'dependencies = ["a", "bbbb"]',
    ].join('\n')),
    [
        escapedProjectHeader,
        'dependencies = ["bbbb", "a"]',
    ].join('\n'),
    'escaped basic quoted table keys are decoded semantically',
);

const unicodeEscape = `${slash}U0001F600`;
const unicodeInput = `[project]\ndependencies = ["${unicodeEscape}", "abc"]\n`;
const unicodeExpected = `[project]\ndependencies = ["abc", "${unicodeEscape}"]\n`;
eq(
    formatPyprojectDependencies(unicodeInput),
    unicodeExpected,
    'TOML Unicode escapes are decoded before dependency sorting',
);

const quote = '"';
const escapedQuoteRaw = `${quote}a${slash}${quote}${quote}`;
const escapedQuoteInput = `[project]\ndependencies = [${escapedQuoteRaw}, "bbb"]\n`;
const escapedQuoteExpected = `[project]\ndependencies = ["bbb", ${escapedQuoteRaw}]\n`;
eq(
    formatPyprojectDependencies(escapedQuoteInput),
    escapedQuoteExpected,
    'escaped quotes sort by their decoded TOML value',
);

const arrayTableBoundary = [
    '[project]',
    'dependencies = ["a", "bbbb"]',
    '[[tool.example]]',
    'dependencies = ["short", "much-longer"]',
].join('\n');
eq(
    formatPyprojectDependencies(arrayTableBoundary),
    [
        '[project]',
        'dependencies = ["bbbb", "a"]',
        '[[tool.example]]',
        'dependencies = ["short", "much-longer"]',
    ].join('\n'),
    'array-of-table headers terminate the project table range',
);

console.log('\nAll pyproject.toml tests passed.');
