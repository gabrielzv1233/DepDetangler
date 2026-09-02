const path = require('path');
const vscode = require('vscode');
const { clearMetadataCache, resolveMetadata } = require('./src/metadata');
const { formatPythonSelection } = require('./src/pythonImports');
const {
    canonicalName,
    extractProjectNames,
    formatRequirements,
    parseRequirementLine,
} = require('./src/requirements');

let diagnostics;
let lastEditorState;

function isRequirementsDocument(document) {
    if (document.languageId === 'pip-requirements') return true;
    return /^requirements-?.*\.txt$/i.test(path.basename(document.fileName));
}

function explicitSetting(config, key) {
    const values = config.inspect(key);
    if (!values) return undefined;
    return values.workspaceFolderLanguageValue
        ?? values.workspaceLanguageValue
        ?? values.globalLanguageValue
        ?? values.workspaceFolderValue
        ?? values.workspaceValue
        ?? values.globalValue;
}

function getSetting(document, key, fallback) {
    const currentConfig = vscode.workspace.getConfiguration('depDetangler', document.uri);
    const previousConfig = vscode.workspace.getConfiguration('pythonPackage', document.uri);
    const legacyConfig = vscode.workspace.getConfiguration('strictPythonFormatter', document.uri);
    const current = explicitSetting(currentConfig, key);
    if (current !== undefined) return current;
    const previous = explicitSetting(previousConfig, key);
    if (previous !== undefined) return previous;
    const legacy = explicitSetting(legacyConfig, key);
    if (legacy !== undefined) return legacy;
    return currentConfig.get(key, fallback);
}

function getRequirementsOptions(document) {
    return {
        extraMode: getSetting(document, 'requirements.extraMode', 'merge'),
        normalizeExtras: getSetting(document, 'requirements.normalizeExtras', true),
        pypiNameLookup: getSetting(document, 'requirements.pypiNameLookup', 'both'),
        cacheTtlDays: getSetting(document, 'requirements.cacheTtlDays', 7),
        preferInstalledMetadata: getSetting(document, 'requirements.preferInstalledMetadata', true),
    };
}

function getPythonOptions(document) {
    return {
        collapseMultilineImports: getSetting(document, 'python.collapseMultilineImports', false),
        expandMultiImports: getSetting(document, 'python.expandMultiImports', false),
        alwaysSeparateSingleLines: getSetting(document, 'python.alwaysSeparateSingleLines', true),
        separateFromImports: getSetting(document, 'python.separateFromImports', false),
    };
}

function entireDocumentRange(document) {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function findPackageRange(document, packageName) {
    const wanted = canonicalName(packageName);
    for (let line = 0; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;
        const parsed = parseRequirementLine(text, line);
        if (!parsed || parsed.canonical !== wanted) continue;
        const start = text.toLowerCase().indexOf(parsed.name.toLowerCase());
        return new vscode.Range(line, Math.max(0, start), line, Math.max(0, start) + parsed.name.length);
    }
    return new vscode.Range(0, 0, 0, Math.min(1, document.lineAt(0)?.text.length || 0));
}

function publishDiagnostics(uri, messages) {
    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (!document) return;

    const seen = new Set();
    const items = [];
    for (const item of messages) {
        const key = `${canonicalName(item.package)}\0${item.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const diagnostic = new vscode.Diagnostic(
            findPackageRange(document, item.package),
            item.message,
            vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'DepDetangler';
        items.push(diagnostic);
    }
    diagnostics.set(uri, items);
}

async function formatRequirementsDocument(document, context) {
    const text = document.getText();
    const options = getRequirementsOptions(document);
    const projectNames = extractProjectNames(text);
    const workspacePath = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    const metadata = await resolveMetadata(projectNames, context, { ...options, workspacePath });
    const result = formatRequirements(text, options, metadata);

    setTimeout(() => publishDiagnostics(document.uri, result.diagnostics), 100);
    if (result.text === text) return [];
    return [vscode.TextEdit.replace(entireDocumentRange(document), result.text)];
}

function snapshotEditor(editor) {
    if (!editor) return;
    lastEditorState = {
        uri: editor.document.uri.toString(),
        selections: editor.selections.map((selection) => ({
            start: { line: selection.start.line, character: selection.start.character },
            end: { line: selection.end.line, character: selection.end.character },
            activeLine: selection.active.line,
        })),
    };
}

function clampPosition(document, position) {
    const line = Math.max(0, Math.min(position.line, document.lineCount - 1));
    const character = Math.max(0, Math.min(position.character, document.lineAt(line).text.length));
    return new vscode.Position(line, character);
}

async function getSortTarget() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return {
            document: editor.document,
            editor,
            selections: editor.selections,
        };
    }

    if (!lastEditorState) return null;
    const uri = vscode.Uri.parse(lastEditorState.uri);
    let document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === lastEditorState.uri);
    if (!document) {
        try {
            document = await vscode.workspace.openTextDocument(uri);
        } catch {
            return null;
        }
    }

    const selections = lastEditorState.selections.map((selection) => {
        const start = clampPosition(document, selection.start);
        const end = clampPosition(document, selection.end);
        const activeLine = Math.max(0, Math.min(selection.activeLine, document.lineCount - 1));
        return {
            isEmpty: start.isEqual(end),
            start,
            end,
            active: new vscode.Position(activeLine, 0),
        };
    });

    return { document, selections };
}

async function sortImportsCommand() {
    const target = await getSortTarget();
    if (!target) {
        vscode.window.showInformationMessage('DepDetangler: no active or recent editor is available.');
        return;
    }

    const { document, editor } = target;
    if (document.languageId !== 'python' && !/\.pyi?$/i.test(document.fileName)) {
        vscode.window.showWarningMessage('DepDetangler: Sort Imports only works in Python files.');
        return;
    }

    const options = getPythonOptions(document);
    let selections = target.selections.filter((selection) => !selection.isEmpty).map((selection) => {
        const startLine = selection.start.line;
        let endLine = selection.end.line;
        if (selection.end.character === 0 && endLine > startLine) endLine--;

        const start = new vscode.Position(startLine, 0);
        const end = endLine < document.lineCount - 1
            ? new vscode.Position(endLine + 1, 0)
            : document.lineAt(endLine).range.end;
        return new vscode.Range(start, end);
    });
    if (!selections.length) {
        const line = target.selections[0]?.active.line ?? 0;
        selections = [document.lineAt(Math.max(0, Math.min(line, document.lineCount - 1))).range];
    }

    const edits = selections
        .map((selection) => ({
            selection,
            original: document.getText(selection),
        }))
        .map((item) => ({
            ...item,
            formatted: formatPythonSelection(item.original, options),
        }))
        .filter((item) => item.formatted !== item.original)
        .sort((a, b) => document.offsetAt(b.selection.start) - document.offsetAt(a.selection.start));

    if (!edits.length) return;

    if (editor) {
        await editor.edit((builder) => {
            for (const edit of edits) builder.replace(edit.selection, edit.formatted);
        });
        return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) workspaceEdit.replace(document.uri, edit.selection, edit.formatted);
    await vscode.workspace.applyEdit(workspaceEdit);
}

function registerSortCommand(context, command) {
    context.subscriptions.push(vscode.commands.registerCommand(command, sortImportsCommand));
}

function activate(context) {
    diagnostics = vscode.languages.createDiagnosticCollection('depDetangler');
    context.subscriptions.push(diagnostics);

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) snapshotEditor(editor);
    }));

    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) snapshotEditor(event.textEditor);
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        diagnostics.delete(document.uri);
        if (lastEditorState?.uri === document.uri.toString()) lastEditorState = undefined;
    }));

    for (const command of [
        'depDetangler.sortImports',
        'depDetangler.organizeImports',
        'depDetangler.sortPackages',
        'depDetangler.organizePackages',
        'depDetangler.sortModules',
        'depDetangler.organizeModules',
        'pythonPackage.sortImports',
        'pythonPackage.organizeImports',
        'pythonPackage.sortPackages',
        'pythonPackage.organizePackages',
        'pythonPackage.sortModules',
        'pythonPackage.organizeModules',
        'strictPythonFormatter.formatSelection',
    ]) registerSortCommand(context, command);

    context.subscriptions.push(vscode.commands.registerCommand(
        'depDetangler.clearPyPICache',
        async () => {
            await clearMetadataCache(context);
            vscode.window.showInformationMessage('DepDetangler: PyPI metadata cache cleared.');
        },
    ));

    context.subscriptions.push(vscode.commands.registerCommand(
        'pythonPackage.clearPyPICache',
        async () => {
            await clearMetadataCache(context);
            vscode.window.showInformationMessage('DepDetangler: PyPI metadata cache cleared.');
        },
    ));

    context.subscriptions.push(vscode.commands.registerCommand(
        'strictPythonFormatter.clearPyPICache',
        async () => {
            await clearMetadataCache(context);
            vscode.window.showInformationMessage('DepDetangler: PyPI metadata cache cleared.');
        },
    ));

    const selector = [
        { language: 'pip-requirements' },
        {
            scheme: 'file',
            pattern: '**/[Rr][Ee][Qq][Uu][Ii][Rr][Ee][Mm][Ee][Nn][Tt][Ss]*.[Tt][Xx][Tt]',
        },
    ];

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits(document) {
            if (!isRequirementsDocument(document)) return [];
            return formatRequirementsDocument(document, context);
        },
    }));
}

function deactivate() {
    lastEditorState = undefined;
}

module.exports = {
    activate,
    deactivate,
};
