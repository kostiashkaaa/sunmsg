import logging
import os

from app import create_app
from app.extensions import socketio


class _AbortedConnectionFilter(logging.Filter):
    def filter(self, record):
        return 'ConnectionAbortedError' not in record.getMessage()


def configure_web_runtime_logging():
    for logger_name in ('eventlet.wsgi.server', 'werkzeug'):
        logging.getLogger(logger_name).addFilter(_AbortedConnectionFilter())


def create_web_app(config_name=None, overrides=None):
    configure_web_runtime_logging()
    return create_app(config_name, overrides=overrides)


def run_web_server(config_name=None, overrides=None):
    app = create_web_app(config_name, overrides=overrides)
    if (
        app.config['ENV_NAME'] == 'production'
        and not bool(app.config.get('ALLOW_EMBEDDED_WEB_SERVER'))
    ):
        raise RuntimeError(
            'Embedded socketio.run server is disabled in production. '
            'Run the web role behind a reverse proxy with Gunicorn, for example: '
            '`gunicorn --worker-class gthread --workers 2 --threads 8 '
            '--bind 127.0.0.1:8000 wsgi:app`.'
        )

    port = int(app.config['PORT'])
    debug = bool(app.config['DEBUG'])
    host = app.config['HOST']
    cert = app.config['TLS_CERT_PATH']
    key = app.config['TLS_KEY_PATH']
    allow_unsafe_werkzeug = bool(app.config['ALLOW_UNSAFE_WERKZEUG'])

    if os.path.exists(cert) and os.path.exists(key):
        tls_port = int(app.config['TLS_PORT'])
        try:
            socketio.run(
                app,
                host=host,
                port=tls_port,
                certfile=cert,
                keyfile=key,
                allow_unsafe_werkzeug=allow_unsafe_werkzeug,
            )
        except TypeError as exc:
            # Werkzeug (threading mode) expects ssl_context instead of certfile/keyfile.
            if "unexpected keyword argument 'certfile'" not in str(exc):
                raise
            socketio.run(
                app,
                host=host,
                port=tls_port,
                ssl_context=(cert, key),
                allow_unsafe_werkzeug=allow_unsafe_werkzeug,
            )
    else:
        socketio.run(
            app,
            host=host,
            port=port,
            debug=debug,
            use_reloader=debug,
            allow_unsafe_werkzeug=allow_unsafe_werkzeug,
        )

    return app
