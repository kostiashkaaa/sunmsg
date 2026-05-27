from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_bi_plus_large_maps_to_local_plus_icon():
    adapter_src = (ROOT / 'static' / 'modules' / 'bi-icon-adapter.js').read_text(encoding='utf-8')

    assert "'bi-plus-lg': 'sun-i-plus'" in adapter_src
