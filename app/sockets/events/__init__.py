import sys
import types

from . import context as _context

from . import chat_access as _chat_access  # noqa: F401
from . import errors as _errors  # noqa: F401
from . import bootstrap  # noqa: F401
from . import presence  # noqa: F401
from . import moderation  # noqa: F401
from . import calls  # noqa: F401

for _name in dir(_context):
    if _name.startswith('__'):
        continue
    globals()[_name] = getattr(_context, _name)


_EVENT_MODULES = (
    _context,
    _chat_access,
    _errors,
    bootstrap,
    presence,
    moderation,
    calls,
)


class _EventsModule(types.ModuleType):
    """Keep legacy monkeypatch behavior by mirroring assignments to split modules."""

    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        for module in _EVENT_MODULES:
            if hasattr(module, name):
                setattr(module, name, value)


sys.modules[__name__].__class__ = _EventsModule
