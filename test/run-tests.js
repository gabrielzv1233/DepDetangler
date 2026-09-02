const assert = require('assert');
const { strictCompare } = require('../src/sort');
const { formatPythonSelection } = require('../src/pythonImports');
const { formatRequirements, resolveVersionSpecs } = require('../src/requirements');

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

const requirementInput = [
    'fastapi>=0.111',
    'uvicorn[standard]>=0.29',
    'httpx>=0.27',
    'openai-whisper>=20231117',
    'stable-ts>=2.17',
    'faster-whisper>=1.1',
].join('\n');

const requirementExpected = [
    'openai-whisper>=20231117',
    'uvicorn[standard]>=0.29',
    'faster-whisper>=1.1',
    'stable-ts>=2.17',
    'fastapi>=0.111',
    'httpx>=0.27',
].join('\n');

eq(formatRequirements(requirementInput, { pypiNameLookup: 'off' }).text, requirementExpected, 'full requirement line length sorting');

eq(
    formatRequirements('ray[tune,rllib,serve]>=2.0', { pypiNameLookup: 'off' }).text,
    'ray[rllib,serve,tune]>=2.0',
    'extras use strict sorting',
);

eq(
    formatRequirements([
        'ray[tune]>=2.0',
        'ray[rllib]>=2.5',
        'ray[serve]>=2.1',
    ].join('\n'), { pypiNameLookup: 'off', extraMode: 'merge' }).text,
    'ray[rllib,serve,tune]>=2.5',
    'merge extras and strongest minimum version',
);

eq(
    formatRequirements([
        'ray[tune]>=2.0',
        'ray[rllib]>=2.5',
        'ray[serve]>=2.1',
    ].join('\n'), { pypiNameLookup: 'off', extraMode: 'preserve' }).text,
    [
        'ray[rllib]>=2.5',
        'ray[serve]>=2.5',
        'ray[tune]>=2.5',
    ].join('\n'),
    'preserve extras with shared resolved version',
);

eq(
    formatRequirements([
        'requests>=2',
        'torch[cuda]>=2',
        'ray[tune]>=2',
        'fastapi>=1',
        'ray[rllib]>=2',
        'ray[serve]>=2',
    ].join('\n'), { pypiNameLookup: 'off', extraMode: 'individual' }).text,
    [
        'ray[rllib]>=2',
        'ray[serve]>=2',
        'ray[tune]>=2',
        '',
        'torch[cuda]>=2',
        'requests>=2',
        'fastapi>=1',
    ].join('\n'),
    'individual mode groups only packages with multiple distinct extras',
);

const exact = resolveVersionSpecs(['>=2.0', '==2.5', '<3.0']);
eq(exact.spec, '==2.5', 'exact version priority');
assert.strictEqual(exact.conflict, false);

const compatibleShort = resolveVersionSpecs(['~=2.4']);
eq(compatibleShort.spec, '>=2.4,<3', 'compatible release with two components');
const compatiblePatch = resolveVersionSpecs(['~=2.4.0']);
eq(compatiblePatch.spec, '>=2.4.0,<2.5', 'compatible release preserves specified trailing component');

const conflict = resolveVersionSpecs(['>=5', '<4']);
eq(conflict.spec, '>=5', 'unresolvable range falls back to newest lower bound');
assert.strictEqual(conflict.conflict, true);

const direct = formatRequirements([
    'demo>=2',
    'demo @ https://example.com/demo.whl',
].join('\n'), { pypiNameLookup: 'off' });
assert.strictEqual(direct.text.split('\n').length, 2);
assert.ok(direct.diagnostics.some((item) => item.message.includes('multiple sources')));
console.log('PASS direct URL conflict is preserved and diagnosed');

eq(
    formatPythonSelection([
        'import json',
        'import pathlib',
        'import requests',
        'import abc1',
        'import _socket',
        'import abca',
        'import abc_',
        'import os',
    ].join('\n')),
    [
        'import requests',
        'import _socket',
        'import pathlib',
        'import abc_',
        'import abc1',
        'import abca',
        'import json',
        'import os',
    ].join('\n'),
    'python import statement sorting',
);


eq(
    formatPythonSelection([
        'from __future__ import annotations',
        '',
        'import argparse',
        'import os',
        'import platform',
        'import shutil',
        'import signal',
        'import subprocess',
        'import sys',
        'import time',
        'import urllib.error',
        'import urllib.request',
        'import webbrowser',
        'from pathlib import Path',
    ].join('\n')),
    [
        'from __future__ import annotations',
        'from pathlib import Path',
        'import urllib.request',
        'import urllib.error',
        'import subprocess',
        'import webbrowser',
        'import argparse',
        'import platform',
        'import shutil',
        'import signal',
        'import time',
        'import sys',
        'import os',
    ].join('\n'),
    'full-line sorting produces the expected mixed import ordering',
);

eq(
    formatPythonSelection([
        'from collections.abc import Callable, Iterable',
        'from model_catalog import load_catalog',
        'from dataclasses import dataclass, field',
        'from __future__ import annotations',
        'import urllib.parse',
        'import threading',
        'import tempfile',
        'import hashlib',
        'import pathlib',
        'import shutil',
        'import httpx',
        'import json',
        'import time',
        'import os',
    ].join('\n')),
    [
        'from collections.abc import Callable, Iterable',
        'from dataclasses import dataclass, field',
        'from model_catalog import load_catalog',
        'from __future__ import annotations',
        'import urllib.parse',
        'import threading',
        'import tempfile',
        'import hashlib',
        'import pathlib',
        'import shutil',
        'import httpx',
        'import json',
        'import time',
        'import os',
    ].join('\n'),
    'python imports sort by the full rendered line after imported names are formatted',
);

eq(
    formatPythonSelection([
        'from x import y',
        'import very_long_module_name',
    ].join('\n')),
    [
        'import very_long_module_name',
        'from x import y',
    ].join('\n'),
    'from and plain imports share one full-line sorting pool by default',
);

eq(
    formatPythonSelection([
        'import very_long_module_name',
        'from x import y',
    ].join('\n'), { separateFromImports: true }),
    [
        'from x import y',
        '',
        'import very_long_module_name',
    ].join('\n'),
    'optional from-import separation groups from imports above plain imports with one blank line',
);

eq(
    formatPythonSelection('from fastapi import Depends, HTTPException, FastAPI, APIRouter'),
    'from fastapi import FastAPI, HTTPException, APIRouter, Depends',
    'module name matching import is first',
);

eq(
    formatPythonSelection([
        'from fastapi import (',
        '    Depends,',
        '    HTTPException,',
        '    FastAPI,',
        '    APIRouter,',
        ')',
    ].join('\n')),
    [
        'from fastapi import (',
        '    FastAPI,',
        '    HTTPException,',
        '    APIRouter,',
        '    Depends,',
        ')',
    ].join('\n'),
    'multiline from import preserves multiline shape',
);

eq(
    formatPythonSelection([
        'from fastapi import (',
        '    Depends,',
        '    HTTPException,',
        '    FastAPI,',
        '    APIRouter,',
        ')',
    ].join('\n'), { collapseMultilineImports: true }),
    'from fastapi import FastAPI, HTTPException, APIRouter, Depends',
    'multiline collapse option',
);

eq(
    formatPythonSelection('import tempfile, shutil, json, time, sys, os, re, argparse, hashlib, signal', { alwaysSeparateSingleLines: false }),
    'import argparse, tempfile, hashlib, shutil, signal, json, time, sys, os, re',
    'combined plain imports are sorted in place when standalone separation is disabled',
);

eq(
    formatPythonSelection('import tempfile, shutil, json'),
    [
        'import tempfile',
        'import shutil',
        'import json',
    ].join('\n'),
    'standalone multi import expands by default',
);

eq(
    formatPythonSelection([
        'before = 1',
        '',
        'import tempfile, shutil, json',
        '',
        'after = 2',
    ].join('\n')),
    [
        'before = 1',
        '',
        'import tempfile',
        'import shutil',
        'import json',
        '',
        'after = 2',
    ].join('\n'),
    'standalone multi import expands when selection also contains blank and non-import lines',
);

eq(
    formatPythonSelection([
        'import tempfile, shutil, json',
        'import pathlib',
    ].join('\n')),
    [
        'import tempfile, shutil, json',
        'import pathlib',
    ].join('\n'),
    'multi import stays combined when another import is selected and expansion is disabled',
);

eq(
    formatPythonSelection('import os, requests, pathlib', { expandMultiImports: true }),
    [
        'import requests',
        'import pathlib',
        'import os',
    ].join('\n'),
    'expand multi imports puts each plain import on its own line',
);

eq(
    formatPythonSelection([
        'import os, requests',
        'import pathlib',
    ].join('\n')),
    [
        'import requests, os',
        'import pathlib',
    ].join('\n'),
    'sorted combined import line participates in normal full-line sorting',
);


eq(
    formatPythonSelection([
        'import os',
        '',
        'import requests',
    ].join('\n')),
    [
        'import requests',
        'import os',
    ].join('\n'),
    'blank lines inside a selected import block do not prevent sorting',
);

eq(
    formatPythonSelection('from package import thinga, thing2, thing_'),
    'from package import thing_, thing2, thinga',
    'same-length imported names use symbol-number-letter priority',
);

eq(
    formatRequirements(['demo', 'demo>=1', 'demo>=2', 'demo>=2'].join('\n'), { pypiNameLookup: 'off' }).text,
    'demo>=2',
    'unversioned and duplicate package entries collapse to strongest resolved version',
);

eq(
    formatRequirements(['ray[TUNE]>=1', 'ray[tune]>=1', 'ray[serve]>=2'].join('\n'), { pypiNameLookup: 'off' }).text,
    'ray[serve,tune]>=2',
    'extras are case-insensitive for duplicate merging',
);

const metadata = new Map([
    ['some-package', { name: 'Some-Package', extras: ['GPU-Extra'] }],
]);
eq(
    formatRequirements('some_package[gpu_extra]>=1', { pypiNameLookup: 'both' }, metadata).text,
    'Some-Package[GPU-Extra]>=1',
    'authoritative metadata spelling is applied to package and extras',
);

const markerResult = formatRequirements([
    'demo>=2; python_version >= "3.12"',
    'demo>=1; python_version < "3.12"',
].join('\n'), { pypiNameLookup: 'off' });
assert.strictEqual(markerResult.text.split('\n').length, 2);
console.log('PASS environment markers remain distinct');

assert.ok(strictCompare('_abc', '1abc') < 0);
assert.ok(strictCompare('1abc', 'aabc') < 0);
console.log('PASS tie character priority');

console.log('\nAll tests passed.');
