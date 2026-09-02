# DepDetangler

**Dependency Detangler for Python** is an opinionated, configurable VS Code formatter for Python imports and pip requirements files. It cleans up duplicates, reconciles compatible version constraints, normalizes package metadata, and applies one consistent ordering rule to the final text.

> [!IMPORTANT]
> DepDetangler is **not a standard alphabetical sorter** and does not try to reproduce isort or PEP 8 import groups. Its defaults implement the my preferred, specific ordering. Settings are available for some specific choices that others may reasonably prefer.

## What it formats

- pip requirements files through VS Code's **Format Document** action
- highlighted Python imports through **DepDetangler: Sort Imports**
- package extras and imported names within their statements
- duplicate requirement entries, including compatible version constraints
- package and extra spelling using installed metadata or PyPI when enabled

The extension has no runtime npm dependencies.

## The ordering rule

DepDetangler sorts the **entire requirement or import statement**, not only the package or module name:

1. Longer text comes first.
2. Equal-length text is compared character by character in ascending order.
3. At each character, the priority is `_`, other symbols, numbers, then letters.

Letters are compared case-insensitively first, with their original case used as the final tie-breaker. The same core rule is reused for requirement lines, Python import statements, imported names, and extras.

This means output can look intentionally different from conventional alphabetization. Version constraints, extras, markers, aliases, comments, and direct URLs can all affect an item's final length and position.

## Quick start

### Format a requirements file

Open a supported requirements file and run VS Code's **Format Document** command (`Shift+Alt+F`). If VS Code asks you to select a formatter, choose **DepDetangler**.

DepDetangler handles documents whose language ID is `pip-requirements` and files whose basename starts with `requirements` and ends with `.txt`, case-insensitively. Examples include:

- `requirements.txt`
- `requirements-dev.txt`
- `Requirements-test.TXT`

### Sort Python imports

Select one or more Python import lines and run **DepDetangler: Sort Imports** from the Command Palette. The command ID is `depDetangler.sortImports`.

The default keybinding is `Shift+Alt+F`, and si active only when text is selected in a Python editor. With no selection, invoking the command from the Command Palette formats the caret/cursors current line.

Only the selected or current lines are parsed; DepDetangler never reorganizes the entire Python file implicitly, even when non imports are highlighted.

## Requirements formatting

The full rendered requirement participates in sorting:

```text
fastapi>=0.111
uvicorn[standard]>=0.29
httpx>=0.27
openai-whisper>=20231117
stable-ts>=2.17
faster-whisper>=1.1
```

becomes:

```text
openai-whisper>=20231117
uvicorn[standard]>=0.29
faster-whisper>=1.1
stable-ts>=2.17
fastapi>=0.111
httpx>=0.27
```

### Duplicates and versions

Names are matched case-insensitively using Python package-name normalization. Duplicate declarations are combined when their environment marker and source match.

When version constraints overlap, DepDetangler resolves them deterministically:

- exact versions take priority; if several are present, the highest exact version wins
- the strongest compatible lower and upper bounds are combined
- `~=` and wildcard equality constraints are converted to compatible bounds when possible
- exclusions such as `!=` are retained
- unversioned duplicates collapse into the resolved versioned entry

If constraints cannot be reconciled, DepDetangler keeps a deterministic fallback and reports a warning in VS Code's **Problems** panel. Environment markers remain separate. Direct URLs are preserved as distinct sources, and conflicting sources also produce a warning.

Comments attached directly to requirements are retained and merged without duplicate copies. Requirement directives and other unrecognized non-empty lines are preserved ahead of the sorted requirements.

### Extras

Extras use the same ordering rule as everything else:

```text
ray[tune,rllib,serve]>=2.0
```

becomes:

```text
ray[rllib,serve,tune]>=2.0
```

The `depDetangler.requirements.extraMode` setting controls duplicate extras:

| Mode         | Behavior                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `merge`      | Merge all extras for a package into one requirement. This is the default.                                                          |
| `preserve`   | Keep distinct extra sets on separate lines while applying the shared resolved version.                                             |
| `individual` | Emit one extra per line. Packages with multiple distinct extras become blank-line-separated groups; ungrouped dependencies follow. |

### Package metadata and PyPI

By default, `depDetangler.requirements.pypiNameLookup` is `both`, so DepDetangler restores authoritative package and extra spelling when it can. It checks installed distribution metadata first, including common workspace environments such as `.venv`, `venv`, and `env`, then queries the PyPI JSON API for missing metadata.

PyPI results are cached for seven days by default. If PyPI is unavailable, stale cached metadata may still be used. Set name lookup to `off` for fully local formatting, or run **DepDetangler: Clear PyPI Metadata Cache** to remove cached entries.

## Python import formatting

Selected import statements are rendered and then sorted together by default. Blank lines inside a selected import block do not create conventional import groups.

```python
from __future__ import annotations
import argparse
import os
import urllib.error
import urllib.request
from pathlib import Path
```

becomes:

```python
from __future__ import annotations
from pathlib import Path
import urllib.request
import urllib.error
import argparse
import os
```

For `from x import ...` statements, imported names are sorted before the complete statement is placed. A name matching the final component of its module is forced first, case-insensitively:

```python
from flask import render_template, Flask
```

becomes:

```python
from flask import Flask, render_template
```

Comma-separated plain imports are sorted in place when they appear alongside other recognized imports. A standalone comma-separated `import` is expanded to one import per line by default. These choices can be changed with `alwaysSeparateSingleLines` and `expandMultiImports`.

Parenthesized multiline `from` imports keep their multiline layout by default. Multiline statements containing internal comments are left structurally intact so those comments are not misplaced.

The command supports multiple selections and formats each selected range independently. If no editor is active, it can fall back to the most recently active editor from the current extension-host session; that fallback is not persisted across reloads. Non-Python files are never modified by the command.

## Settings

Search for `DepDetangler` in VS Code Settings, or configure these keys directly:

| Setting                                             | Default | Effect                                                                                  |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `depDetangler.requirements.extraMode`               | `merge` | Choose how duplicate package extras are emitted.                                        |
| `depDetangler.requirements.normalizeExtras`         | `true`  | Normalize non-authoritative extra names to lowercase with hyphens.                      |
| `depDetangler.requirements.pypiNameLookup`          | `both`  | Restore package names, extra names, both, or neither from installed/PyPI metadata.      |
| `depDetangler.requirements.preferInstalledMetadata` | `true`  | Check local Python distribution metadata before PyPI.                                   |
| `depDetangler.requirements.cacheTtlDays`            | `7`     | Set the lifetime of cached PyPI metadata in days.                                       |
| `depDetangler.python.collapseMultilineImports`      | `false` | Collapse recognized multiline `from` imports to one line.                               |
| `depDetangler.python.expandMultiImports`            | `false` | Always split comma-separated plain imports into individual statements.                  |
| `depDetangler.python.alwaysSeparateSingleLines`     | `true`  | Split a standalone comma-separated plain import even when global expansion is disabled. |
| `depDetangler.python.separateFromImports`           | `false` | Put `from` imports above plain imports with one blank line between the groups.          |

Example configuration:

```json
{
	"depDetangler.requirements.extraMode": "merge",
	"depDetangler.requirements.normalizeExtras": true,
	"depDetangler.requirements.pypiNameLookup": "both",
	"depDetangler.requirements.preferInstalledMetadata": true,
	"depDetangler.requirements.cacheTtlDays": 7,
	"depDetangler.python.collapseMultilineImports": false,
	"depDetangler.python.expandMultiImports": false,
	"depDetangler.python.alwaysSeparateSingleLines": true,
	"depDetangler.python.separateFromImports": false
}
```

## Development

DepDetangler uses plain CommonJS JavaScript. Run the core test suite with:

```powershell
npm test
```

To test the extension in VS Code, open this repository and press `F5` to launch the included **Run DepDetangler** Extension Development Host configuration.

## Support

If DepDetangler is useful to you, you can [support its development on Ko-fi](https://ko-fi.com/gabrielzv1233).

## License

DepDetangler is licensed under the [GNU General Public License version 3](LICENSE) (`GPL-3.0-only`).

> Note, I both don't know what to use for a project icon and am too too lazy to make one, so it doesn't have one yet :)
