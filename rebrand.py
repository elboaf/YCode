#!/usr/bin/env python3
"""Case-aware zcode → ycode rebrand script."""

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# Skip directories that shouldn't be modified
SKIP_DIRS = {'.git', 'node_modules', '.pnpm-store'}

# Binary file extensions to skip
BINARY_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.zip', '.tar',
               '.gz', '.bz2', '.xz', '.rar', '.7z', '.wasm', '.woff', '.woff2',
               '.ttf', '.eot', '.pdf', '.exe', '.msi', '.dmg', '.nupkg', '.deb'}

def is_binary(filepath):
    try:
        _, ext = os.path.splitext(filepath)
        if ext.lower() in BINARY_EXTS:
            return True
        with open(filepath, 'rb') as f:
            chunk = f.read(8192)
            if b'\x00' in chunk:
                return True
    except:
        return True
    return False

# Case-aware replacement rules
# We match word boundaries to avoid partial replacements
REPLACEMENTS = [
    # Uppercase: ZCODE → YCODE
    (r'\bZCODE\b', 'YCODE'),
    (r'\bZCODE_', 'YCODE_'),
    # Capitalized: ZCode → YCode
    (r'\bZCode\b', 'YCode'),
    (r'\bZCode_', 'YCode_'),
    # Mixed: zCode → yCode
    (r'\bzCode\b', 'yCode'),
    # Lowercase: zcode → ycode
    (r'\bzcode\b', 'ycode'),
    (r'\bzcode_', 'ycode_'),
]

def fix_content(content):
    """Apply all replacement rules to content."""
    for pattern, replacement in REPLACEMENTS:
        content = re.sub(pattern, replacement, content)
    return content

def collect_files():
    """Collect all files that need modification."""
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # Skip skip directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if filepath == os.path.join(ROOT, 'rebrand.py'):
                continue
            if is_binary(filepath):
                continue
            files.append(filepath)
    return files

def main():
    files = collect_files()
    total = 0
    modified = 0
    
    for filepath in files:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception:
            continue
        
        new_content = fix_content(content)
        if new_content != content:
            modified += 1
            with open(filepath, 'w', encoding='utf-8', newline='') as f:
                f.write(new_content)
            total += 1
            print(f"  {os.path.relpath(filepath, ROOT)}")
    
    print(f"\nTotal files scanned: {len(files)}")
    print(f"Files modified: {total}")
    
    # Verify no remaining zcode references
    remaining = 0
    for filepath in files:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            if re.search(r'\bzcode\b', content, re.IGNORECASE):
                remaining += 1
        except:
            pass
    
    print(f"Files with remaining zcode references: {remaining}")
    return remaining

if __name__ == '__main__':
    sys.exit(main())
