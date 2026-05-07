import sys
import types

from .context import *  # noqa: F401,F403
from . import context as _context

from . import routes_login  # noqa: F401
from . import routes_register  # noqa: F401
from . import routes_totp  # noqa: F401
from . import routes_passkeys  # noqa: F401
from . import routes_key_transfer  # noqa: F401
from . import routes_settings  # noqa: F401
from . import routes_sessions  # noqa: F401
from . import routes_web_push  # noqa: F401
from . import routes_trust  # noqa: F401


_ROUTE_MODULES = (
    routes_login,
    routes_register,
    routes_totp,
    routes_passkeys,
    routes_key_transfer,
    routes_settings,
    routes_sessions,
    routes_web_push,
    routes_trust,
)


class _AuthModule(types.ModuleType):
    """Keep legacy monkeypatch behavior by mirroring assignments to split modules."""

    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        if hasattr(_context, name):
            setattr(_context, name, value)
        for module in _ROUTE_MODULES:
            if hasattr(module, name):
                setattr(module, name, value)


sys.modules[__name__].__class__ = _AuthModule
