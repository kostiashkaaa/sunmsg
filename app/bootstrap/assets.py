from pathlib import Path

from flask import Flask, g, request, session, url_for

from app.services.locale import detect_auth_language, normalize_language


def register_asset_helpers(app: Flask) -> None:
    @app.context_processor
    def inject_asset_helpers():
        static_root = Path(app.static_folder or "").resolve()

        def asset_url(filename: str) -> str:
            normalized = str(filename or "").lstrip("/").replace("\\", "/")
            version = "0"
            try:
                asset_path = (static_root / normalized).resolve()
                if asset_path.is_file():
                    version = str(asset_path.stat().st_mtime_ns)
            except OSError:
                pass
            return url_for("static", filename=normalized, v=version)

        resolved_ui_language = normalize_language(
            session.get("ui_language"),
            default=normalize_language(
                session.get("guest_ui_language"),
                default=detect_auth_language(request),
            ),
        )

        return {
            "asset_url": asset_url,
            "csp_nonce": getattr(g, "csp_nonce", ""),
            "ui_language": resolved_ui_language,
        }

