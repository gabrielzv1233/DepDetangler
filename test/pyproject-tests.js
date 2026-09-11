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

console.log('\nAll pyproject.toml tests passed.');
