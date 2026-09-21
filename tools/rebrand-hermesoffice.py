# HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0,
# Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
# atribuição original preservada em NOTICE.
#!/usr/bin/env python3
"""
Rebrand GenOffice -> HermesOffice (thin fork layer).

Aplica os replaces de identidade do fork em todo o working tree (exceto
package-lock.json, que é regenerado via `npm install`, e NOTICE/LICENSE
originais que preservam a atribuição Apache-2.0 do upstream).

Uso:
    python3 tools/rebrand-hermesoffice.py [--check]

--check: apenas reporta arquivos que AINDA contêm o nome antigo (útil para
validar que um merge do upstream não reintroduziu "hermesoffice" fora da camada
de compatibilidade).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Pares (old, new) aplicados na ordem. A ordem importa: scoped packages primeiro
# (mais específico), depois env vars, depois ids, depois texto.
REPLACES = [
    ("@hermesoffice/", "@hermesoffice/"),
    ("GENOFFICE_", "HERMESOFFICE_"),
    ("com.genoffice.app", "com.hermesoffice.app"),
    ("GenOffice", "HermesOffice"),
    ("hermesoffice", "hermesoffice"),
]

# Extensões de arquivo que participam do rebrand.
EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml",
              ".md", ".html", ".css", ".svg", ".plist", ".entitlements"}

# Arquivos/dirs que NUNCA são tocados (atribuição original + artefatos gerados).
EXCLUDE_DIRS = {"node_modules", ".git", "dist", "out", "release"}
EXCLUDE_FILES = {"package-lock.json", "LICENSE", "NOTICE",
                 "rebrand-hermesoffice.py"}  # o próprio script não se modifica

# Padrões permitidos a manter "hermesoffice" (camada de compatibilidade/upstream):
# nada por enquanto — a Fase 2 define a ponte de compatibilidade se precisar.


def iter_files():
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDE_DIRS for part in rel.parts):
            continue
        if path.name in EXCLUDE_FILES:
            continue
        if path.suffix not in EXTENSIONS:
            continue
        yield path


def rebrand(path: Path, check: bool) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False
    new = text
    for old, repl in REPLACES:
        new = new.replace(old, repl)
    if new == text:
        return False
    if check:
        print(f"[check] {path.relative_to(ROOT)}")
        return True
    path.write_text(new, encoding="utf-8")
    print(f"[rebr] {path.relative_to(ROOT)}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    # Passada 1: reescreve o CONTEÚDO dos arquivos.
    changed = 0
    for path in iter_files():
        if rebrand(path, args.check):
            changed += 1

    # Passada 2: renomeia ARQUIVOS cujo nome contém o nome antigo
    # (ex: genoffice-logo.svg -> hermesoffice-logo.svg). Coleta antes de
    # renomear para não invalidar a iteração.
    stale = 0
    if not args.check:
        renamed = 0
        for path in list(iter_files()):
            new_name = path.name
            for old, repl in REPLACES:
                new_name = new_name.replace(old, repl)
            if new_name != path.name:
                target = path.with_name(new_name)
                path.rename(target)
                print(f"[renm] {path.relative_to(ROOT)} -> {target.name}")
                renamed += 1
        if renamed:
            print(f"rename: {renamed} arquivo(s)")
    else:
        # --check: reporta arquivos com nome antigo
        stale = 0
        for path in iter_files():
            if any(old in path.name for old, _ in REPLACES):
                print(f"[check] nome: {path.relative_to(ROOT)}")
                stale += 1
        if stale:
            print(f"check: {stale} arquivo(s) com nome antigo")

    print(f"\n{'check:' if args.check else 'rebrand:'} {changed} arquivo(s) de conteúdo")
    return 0 if not args.check or (changed == 0 and stale == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
