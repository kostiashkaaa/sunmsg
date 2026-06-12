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
    sources.append("https://api.open-meteo.com")
    sources.append("https://geocoding-api.open-meteo.com")
    sources.append("https://air-quality-api.open-meteo.com")
    sources.append(app.config.get("CONNECT_SRC_HOSTS"))
    return _csp_sources(*sources)


def _response_is_textual(mimetype: str) -> bool:
    return mimetype.startswith("text/") or mimetype in {
        "application/json",
        "application/javascript",
        "application/x-javascript",
        "application/xml",
        "application/xhtml+xml",
        "image/svg+xml",
    }


def _is_settings_embed_request(path: str, embed_value) -> bool:
    return path == "/settings" and str(embed_value).strip().lower() in {"1", "true", "yes"}


def _build_content_security_policy(
    app: Flask,
    *,
    is_production: bool,
    is_settings_embed: bool,
    csp_nonce: str,
) -> str:
    frame_ancestors = "'self'" if is_settings_embed else "'none'"
    script_nonce = f"'nonce-{csp_nonce}'" if csp_nonce else ""
    style_allow_inline = bool(app.config.get("CSP_STYLE_UNSAFE_INLINE", True))
    if style_allow_inline and is_production:
        # In production CSP_STYLE_UNSAFE_INLINE must be False (ProductionConfig already sets it).
        # Reaching this point means the config was overridden via env; log a warning.
        import logging
        logging.getLogger(__name__).warning(
            "CSP: style-src 'unsafe-inline' is active in production. "
            "Set CSP_STYLE_UNSAFE_INLINE=false to enforce stricter CSP."
        )
    style_nonce = f"'nonce-{csp_nonce}'" if (csp_nonce and not style_allow_inline) else ""
    script_src = _csp_sources("'self'", script_nonce, app.config.get("SCRIPT_SRC_HOSTS"))
    style_inline = "'unsafe-inline'" if style_allow_inline else ""
    style_src = _csp_sources("'self'", style_nonce, style_inline, app.config.get("STYLE_SRC_HOSTS"))
    style_src_elem = _csp_sources("'self'", style_nonce, app.config.get("STYLE_SRC_HOSTS"))
    style_src_attr = "'unsafe-inline'" if style_allow_inline else "'none'"
    font_src = _csp_sources("'self'", app.config.get("FONT_SRC_HOSTS"))
    img_src = _csp_sources("'self'", "data:", "blob:", "https://i.scdn.co", app.config.get("IMG_SRC_HOSTS"))
    media_src = _csp_sources("'self'", "data:", "blob:", app.config.get("MEDIA_SRC_HOSTS"))
    connect_src = _csp_connect_sources(app)
    manifest_src = _csp_sources("'self'")
    worker_src = _csp_sources("'self'", "blob:")
    frame_src = "'self'"
    upgrade_mixed = " upgrade-insecure-requests;" if is_production else ""
    return (
        "default-src 'self'; "
        f"script-src {script_src}; "
        f"style-src {style_src}; "
        f"style-src-elem {style_src_elem}; "
        f"style-src-attr {style_src_attr}; "
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


def _apply_static_cache_headers(response, *, request_path: str, static_prefix: str, static_version: str) -> bool:
    if not request_path.startswith(static_prefix):
        return False
    _, ext = os.path.splitext(request_path)
    static_ext = ext.lower()
    if static_version:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers.pop("Pragma", None)
        response.headers.pop("Expires", None)
        return True
    if static_ext in {".js", ".css", ".mjs", ".json"}:
        response.headers["Cache-Control"] = "no-cache"
        response.headers.pop("Pragma", None)
        response.headers.pop("Expires", None)
        return True
    if static_ext in {
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
        return True
    return True


def _apply_dynamic_html_cache_headers(response) -> None:
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"


def register_security_headers(app: Flask, *, is_production: bool) -> None:
    @app.after_request
    def set_security_headers(response):
        mimetype = str(response.mimetype or "").lower()
        if _response_is_textual(mimetype):
            response.charset = "utf-8"

        request_path = request.path or ""
        static_prefix = f"{(app.static_url_path or '/static').rstrip('/')}/"
        static_version = str(request.args.get("v", "") or "").strip()
        is_settings_embed = _is_settings_embed_request(
            request.path or "",
            request.args.get("embed", ""),
        )
        response.headers["X-Frame-Options"] = "SAMEORIGIN" if is_settings_embed else "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Cross-Origin-Opener-Policy: isolate our window's browsing context
        # from any opener with a different origin. Blocks a family of
        # cross-window XS-Leaks and tightens what an attacker site could
        # inspect about a logged-in tab if it happens to open SUN.
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Referrer-Policy"] = "same-origin"
        # Deny every powerful feature we don't intentionally use. `=()` means
        # "no origin may use this feature". The three features we *do* use
        # (camera/microphone for calls, geolocation for the optional weather
        # widget) are limited to same-origin only. `browsing-topics` and
        # `interest-cohort` opt out of Google's Topics/FLoC inference.
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), "
            "ambient-light-sensor=(), "
            "autoplay=(self), "
            "battery=(), "
            "bluetooth=(), "
            "browsing-topics=(), "
            "camera=(self), "
            "clipboard-read=(self), "
            "clipboard-write=(self), "
            "display-capture=(self), "
            "encrypted-media=(), "
            "fullscreen=(self), "
            "gamepad=(), "
            "geolocation=(self), "
            "gyroscope=(), "
            "hid=(), "
            "idle-detection=(), "
            "interest-cohort=(), "
            "keyboard-map=(), "
            "magnetometer=(), "
            "microphone=(self), "
            "midi=(), "
            "otp-credentials=(), "
            "payment=(), "
            "picture-in-picture=(self), "
            "publickey-credentials-get=(self), "
            "screen-wake-lock=(self), "
            "serial=(), "
            "speaker-selection=(self), "
            "usb=(), "
            "xr-spatial-tracking=()"
        )
        if is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        csp_nonce = str(getattr(g, "csp_nonce", "") or "").strip()
        response.headers["Content-Security-Policy"] = _build_content_security_policy(
            app,
            is_production=is_production,
            is_settings_embed=is_settings_embed,
            csp_nonce=csp_nonce,
        )
        static_headers_applied = _apply_static_cache_headers(
            response,
            request_path=request_path,
            static_prefix=static_prefix,
            static_version=static_version,
        )
        if (not static_headers_applied) and mimetype == "text/html":
            # Dynamic HTML contains embedded bootstrap state and versioned asset URLs.
            # Prevent document caching so a normal reload fetches fresh server state.
            _apply_dynamic_html_cache_headers(response)
        return response
