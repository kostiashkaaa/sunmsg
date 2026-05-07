import os

from flask import Flask, g, request


def _csp_sources(*parts):
    return " ".join(str(part).strip() for part in parts if str(part or "").strip())


def _csp_connect_sources(app: Flask) -> str:
    host = str(request.host or "").strip()
    sources = ["'self'"]
    env_name = str(app.config.get("ENV_NAME") or "").strip().lower()
    is_production = env_name == "production"
    if host:
        if not is_production:
            sources.append(f"ws://{host}")
        sources.append(f"wss://{host}")
    sources.append(app.config.get("CONNECT_SRC_HOSTS"))
    return _csp_sources(*sources)


def register_security_headers(app: Flask, *, is_production: bool) -> None:
    @app.after_request
    def set_security_headers(response):
        mimetype = str(response.mimetype or "").lower()
        if (
            mimetype.startswith("text/")
            or mimetype in {
                "application/json",
                "application/javascript",
                "application/x-javascript",
                "application/xml",
                "application/xhtml+xml",
                "image/svg+xml",
            }
        ):
            response.charset = "utf-8"

        request_path = request.path or ""
        static_prefix = f"{(app.static_url_path or '/static').rstrip('/')}/"
        static_version = str(request.args.get("v", "") or "").strip()
        is_settings_embed = (
            request.path == "/settings"
            and str(request.args.get("embed", "")).strip().lower() in {"1", "true", "yes"}
        )
        response.headers["X-Frame-Options"] = "SAMEORIGIN" if is_settings_embed else "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
        if is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        frame_ancestors = "'self'" if is_settings_embed else "'none'"
        csp_nonce = str(getattr(g, "csp_nonce", "") or "").strip()
        script_nonce = f"'nonce-{csp_nonce}'" if csp_nonce else ""
        style_allow_inline = bool(app.config.get("CSP_STYLE_UNSAFE_INLINE", True))
        style_nonce = f"'nonce-{csp_nonce}'" if (csp_nonce and not style_allow_inline) else ""
        script_src = _csp_sources("'self'", script_nonce, app.config.get("SCRIPT_SRC_HOSTS"))
        style_inline = "'unsafe-inline'" if style_allow_inline else ""
        style_src = _csp_sources("'self'", style_nonce, style_inline, app.config.get("STYLE_SRC_HOSTS"))
        font_src = _csp_sources("'self'", app.config.get("FONT_SRC_HOSTS"))
        img_src = _csp_sources("'self'", "data:", "blob:", app.config.get("IMG_SRC_HOSTS"))
        media_src = _csp_sources("'self'", "data:", "blob:", app.config.get("MEDIA_SRC_HOSTS"))
        connect_src = _csp_connect_sources(app)
        manifest_src = _csp_sources("'self'")
        worker_src = _csp_sources("'self'", "blob:")
        frame_src = "'self'"
        upgrade_mixed = " upgrade-insecure-requests;" if is_production else ""
        csp = (
            "default-src 'self'; "
            f"script-src {script_src}; "
            f"style-src {style_src}; "
            f"font-src {font_src}; "
            f"img-src {img_src}; "
            f"media-src {media_src}; "
            f"connect-src {connect_src}; "
            f"manifest-src {manifest_src}; "
            f"worker-src {worker_src}; "
            f"frame-src {frame_src}; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            f"frame-ancestors {frame_ancestors};"
            f"{upgrade_mixed}"
        )
        response.headers["Content-Security-Policy"] = csp
        if request_path.startswith(static_prefix):
            _, ext = os.path.splitext(request_path)
            static_ext = ext.lower()
            if static_version:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                response.headers.pop("Pragma", None)
                response.headers.pop("Expires", None)
            elif static_ext in {".js", ".css", ".mjs", ".json"}:
                response.headers["Cache-Control"] = "no-cache"
                response.headers.pop("Pragma", None)
                response.headers.pop("Expires", None)
            elif static_ext in {
                ".png",
                ".jpg",
                ".jpeg",
                ".gif",
                ".webp",
                ".svg",
                ".ico",
                ".woff",
                ".woff2",
            }:
                response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=86400"
                response.headers.pop("Pragma", None)
                response.headers.pop("Expires", None)
        return response
