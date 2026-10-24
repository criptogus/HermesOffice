#!/usr/bin/env bash
# Read-only upstream inventory. Explicit base/report make reconciliation repeatable.
# Usage: tools/upstream-diff.sh [candidate-ref] [base-ref] [report.json]
set -euo pipefail
cd "$(dirname "$0")/.."
candidate_ref="${1:-upstream/main}"
base_ref="${2:-}"
report_path="${3:-}"
python3 - "$candidate_ref" "$base_ref" "$report_path" <<'PY'
import collections
import json
from pathlib import Path
import subprocess
import sys

candidate_ref, base_ref, report_path = sys.argv[1:]
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
def classify(path):
    if path.startswith(('tools/rebrand', 'README', 'NOTICE', 'LICENSE', 'docs/')):
        return 'FORK'
    if path.startswith(('packages/ai-provider/', 'packages/agent-core/', 'packages/ai-search/')):
        return 'AI-CORE'
    if path.startswith('packages/') and any(part in path for part in ('-engine/', 'file-parse/', 'xlsx-gateway/', 'pptx-ops/', 'html2docx/')):
        return 'ENGINE'
    if path.startswith('apps/') and any(part in path for part in ('/src/main/', '/src/preload/', '/src/shared/')):
        return 'MAIN'
    if '/src/renderer/' in path or path.startswith('packages/ui/'):
        return 'UI'
    if path.startswith(('.github/', 'e2e/', 'scripts/')) or 'electron-builder' in path:
        return 'INFRA'
    return 'OTHER'
try:
    head = git('rev-parse', '--verify', candidate_ref + '^{commit}')
    base = git('rev-parse', '--verify', base_ref + '^{commit}') if base_ref else git('merge-base', 'HEAD', head)
    raw = git('diff', '--name-status', '--no-renames', base, head)
    if not raw:
        raise ValueError('No changes: empty/no-op inventory rejected')
    files = []
    for row in raw.splitlines():
        status, path = row.split('\t', 1)
        files.append({'status': status, 'path': path, 'area': classify(path)})
    critical = [item['path'] for item in files if item['area'] == 'AI-CORE' or any(token in item['path'] for token in ('AiPanel.tsx', 'shell/src/main/', 'electron-builder', 'docs-main.ts', 'sheets-main.ts', 'ai-ipc.ts'))]
    report = {'base': base, 'candidate': head, 'changedFiles': len(files), 'areas': dict(sorted(collections.Counter(item['area'] for item in files).items())), 'forkReviewRequired': critical, 'files': files}
    if report_path:
        destination = Path(report_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'files' and key != 'forkReviewRequired'}))
    print('Fork-sensitive paths requiring manual review:', len(critical))
except (subprocess.CalledProcessError, ValueError, OSError) as error:
    print('Inventory failed:', error, file=sys.stderr)
    sys.exit(1)
PY
