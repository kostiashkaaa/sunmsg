import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_text(path: Path) -> str:
    return path.read_text('utf-8', errors='replace')


def ids_from_get_element_by_id(src: str) -> set[str]:
    return set(re.findall(r"getElementById\(['\"](\w[\w-]*)['\"]", src))


def ids_created_by_js(src: str) -> set[str]:
    created = set(re.findall(r"\.id\s*=\s*['\"](\w[\w-]*)['\"]", src))
    created.update(re.findall(r'id=["\'](\w[\w-]*)["\']', src))
    return created

# Get all id= from HTML templates
html_ids = set()
for f in (ROOT / 'templates').rglob('*.html'):
    txt = read_text(f)
    html_ids.update(re.findall(r'id=["\'](\w[\w-]*)["\']', txt))

module_dir = ROOT / 'static/modules'
js_files = [(ROOT / 'static/chat.js'), *sorted(module_dir.glob('*.js'))]
dynamic_ids = set()
for js_file in js_files:
    dynamic_ids.update(ids_created_by_js(read_text(js_file)))

# Find missing (not in any template)
chatjs = read_text(ROOT / 'static/chat.js')
ids_in_js = ids_from_get_element_by_id(chatjs)
missing = ids_in_js - html_ids - dynamic_ids
print(f'IDs in chat.js but missing from templates ({len(missing)}):')
for m in sorted(missing):
    print(f'  {m}')

# Also check modules
print()
for mod in sorted(module_dir.glob('*.js')):
    mod_txt = read_text(mod)
    mod_ids = ids_from_get_element_by_id(mod_txt)
    mod_missing = mod_ids - html_ids - dynamic_ids
    if mod_missing:
        print(f'{mod.name} missing IDs:')
        for m in sorted(mod_missing):
            print(f'  {m}')
