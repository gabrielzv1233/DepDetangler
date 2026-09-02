const https = require('https');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_KEY = 'depDetangler.pypiCache.v1';
const PREVIOUS_CACHE_KEY = 'pythonPackage.pypiCache.v1';
const LEGACY_CACHE_KEY = 'strictPythonFormatter.pypiCache.v1';

function runPython(command, args, names) {
    const script = [
        'import importlib.metadata as m, json, sys',
        'out = {}',
        'for name in json.loads(sys.argv[1]):',
        '    try:',
        '        d = m.distribution(name)',
        '    except m.PackageNotFoundError:',
        '        continue',
        '    meta = d.metadata',
        '    out[name] = {"name": meta.get("Name", name), "extras": meta.get_all("Provides-Extra") or []}',
        'print(json.dumps(out))',
    ].join('\n');

    return new Promise((resolve) => {
        execFile(command, [...args, '-c', script, JSON.stringify(names)], { timeout: 2000, windowsHide: true }, (error, stdout) => {
            if (error) return resolve(null);
            try {
                resolve(JSON.parse(stdout));
            } catch {
                resolve(null);
            }
        });
    });
}

async function readInstalledMetadata(names, workspacePath) {
    if (!names.length) return new Map();
    const workspaceCandidates = workspacePath
        ? (process.platform === 'win32'
            ? [
                [path.join(workspacePath, '.venv', 'Scripts', 'python.exe'), []],
                [path.join(workspacePath, 'venv', 'Scripts', 'python.exe'), []],
                [path.join(workspacePath, 'env', 'Scripts', 'python.exe'), []],
            ]
            : [
                [path.join(workspacePath, '.venv', 'bin', 'python'), []],
                [path.join(workspacePath, 'venv', 'bin', 'python'), []],
                [path.join(workspacePath, 'env', 'bin', 'python'), []],
            ])
        : [];
    const candidates = [
        ...workspaceCandidates,
        ...(process.platform === 'win32'
            ? [['py', ['-3']], ['python', []], ['python3', []]]
            : [['python3', []], ['python', []]]),
    ];

    for (const [command, args] of candidates) {
        const result = await runPython(command, args, names);
        if (!result) continue;
        const map = new Map();
        for (const [canonical, metadata] of Object.entries(result)) {
            map.set(canonical, {
                name: metadata.name || canonical,
                extras: Array.isArray(metadata.extras) ? metadata.extras : [],
                source: 'installed',
            });
        }
        return map;
    }
    return new Map();
}

function fetchPyPI(name) {
    return new Promise((resolve) => {
        const request = https.get({
            hostname: 'pypi.org',
            path: `/pypi/${encodeURIComponent(name)}/json`,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'depdetangler-vscode/0.2.1',
            },
            timeout: 3500,
        }, (response) => {
            if (response.statusCode !== 200) {
                response.resume();
                return resolve(null);
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({
                        name: parsed?.info?.name || name,
                        extras: Array.isArray(parsed?.info?.provides_extra) ? parsed.info.provides_extra : [],
                        source: 'pypi',
                    });
                } catch {
                    resolve(null);
                }
            });
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(null));
    });
}

async function mapLimit(values, limit, fn) {
    const output = new Array(values.length);
    let next = 0;
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= values.length) return;
            output[index] = await fn(values[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
    return output;
}

async function resolveMetadata(names, context, options = {}) {
    const unique = [...new Set(names)];
    const mode = options.pypiNameLookup || 'both';
    if (mode === 'off' || !unique.length) return new Map();

    const result = options.preferInstalledMetadata === false
        ? new Map()
        : await readInstalledMetadata(unique, options.workspacePath);

    const cache = context.globalState.get(
        CACHE_KEY,
        context.globalState.get(PREVIOUS_CACHE_KEY, context.globalState.get(LEGACY_CACHE_KEY, {})),
    );
    const ttlMs = Math.max(0, Number(options.cacheTtlDays ?? 7)) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const missing = unique.filter((name) => !result.has(name));
    const staleFallback = new Map();
    const fetchNames = [];

    for (const name of missing) {
        const cached = cache[name];
        if (cached?.metadata) {
            staleFallback.set(name, cached.metadata);
            if (now - Number(cached.fetchedAt || 0) <= ttlMs) {
                result.set(name, { ...cached.metadata, source: 'cache' });
                continue;
            }
        }
        fetchNames.push(name);
    }

    const fetched = await mapLimit(fetchNames, 4, async (name) => [name, await fetchPyPI(name)]);
    let changed = false;
    for (const [name, metadata] of fetched) {
        if (metadata) {
            result.set(name, metadata);
            cache[name] = { fetchedAt: now, metadata: { name: metadata.name, extras: metadata.extras } };
            changed = true;
        } else if (staleFallback.has(name)) {
            result.set(name, { ...staleFallback.get(name), source: 'stale-cache' });
        }
    }

    if (changed) await context.globalState.update(CACHE_KEY, cache);
    return result;
}

async function clearMetadataCache(context) {
    await context.globalState.update(CACHE_KEY, undefined);
    await context.globalState.update(PREVIOUS_CACHE_KEY, undefined);
    await context.globalState.update(LEGACY_CACHE_KEY, undefined);
}

module.exports = {
    CACHE_KEY,
    clearMetadataCache,
    readInstalledMetadata,
    resolveMetadata,
};
