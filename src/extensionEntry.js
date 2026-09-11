const path = require('path');
const vscode = require('vscode');
const baseExtension = require('../extension');
const { formatPyprojectDependencies } = require('./pyproject');

function entireDocumentRange(document) {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function isPyprojectDocument(document) {
    return path.basename(document.fileName).toLowerCase() === 'pyproject.toml';
}

function activate(context) {
    baseExtension.activate(context);

    const selector = [
        { language: 'toml', pattern: '**/pyproject.toml' },
        { scheme: 'file', pattern: '**/[Pp][Yy][Pp][Rr][Oo][Jj][Ee][Cc][Tt].[Tt][Oo][Mm][Ll]' },
    ];

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits(document) {
            if (!isPyprojectDocument(document)) return [];
            const text = document.getText();
            const formatted = formatPyprojectDependencies(text);
            if (formatted === text) return [];
            return [vscode.TextEdit.replace(entireDocumentRange(document), formatted)];
        },
    }));
}

function deactivate() {
    baseExtension.deactivate();
}

module.exports = {
    activate,
    deactivate,
};
