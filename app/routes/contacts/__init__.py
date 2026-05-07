import sys
import types

from . import context as _context

for _name in dir(_context):
    if _name.startswith('__'):
        continue
    globals()[_name] = getattr(_context, _name)

from . import routes_list  # noqa: F401,E402
from . import routes_requests  # noqa: F401,E402
from . import routes_blocking  # noqa: F401,E402
from . import routes_public_card  # noqa: F401,E402


_CONTACTS_MODULES = (
    _context,
    routes_list,
    routes_requests,
    routes_blocking,
    routes_public_card,
)


class _ContactsModule(types.ModuleType):
    """Mirror monkeypatch assignments onto split contacts modules."""

    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        for module in _CONTACTS_MODULES:
            if hasattr(module, name):
                setattr(module, name, value)


sys.modules[__name__].__class__ = _ContactsModule
