from flask import Flask, render_template, request, session
from werkzeug.exceptions import BadRequest, HTTPException, InternalServerError, RequestEntityTooLarge


def _request_prefers_json():
    accept = request.accept_mimetypes
    return (
        request.path.startswith("/api/")
        or request.is_json
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or accept["application/json"] > accept["text/html"]
    )


def _json_error(message, status_code):
    return {"success": False, "error": message}, status_code


def _render_error_page(status_code, title, description, *, detail="", icon="bi-exclamation-octagon"):
    primary_href = "/chat" if session.get("user_id") else "/"
    primary_label = "\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0432 \u0447\u0430\u0442\u044b" if session.get("user_id") else "\u041d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e"
    return render_template(
        "error.html",
        status_code=status_code,
        title=title,
        description=description,
        detail=detail,
        icon=icon,
        primary_href=primary_href,
        primary_label=primary_label,
        request_method=request.method,
        request_path=request.path,
    )


def register_error_handlers(app: Flask, logger) -> None:
    @app.errorhandler(RequestEntityTooLarge)
    def handle_file_too_large(_err):
        return _json_error(
            "\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439. \u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 100 \u041c\u0411.",
            413,
        )

    @app.errorhandler(BadRequest)
    def handle_bad_request(err):
        message = str(getattr(err, "description", "") or "").strip()
        detail = "" if message == BadRequest.description else message
        if _request_prefers_json():
            return _json_error(
                detail or "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441.",
                400,
            )
        return (
            _render_error_page(
                400,
                "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c",
                "\u0421\u0441\u044b\u043b\u043a\u0430, \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0438\u043b\u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u043b\u0438 \u0441 \u0442\u0435\u043c, \u0447\u0442\u043e \u043e\u0436\u0438\u0434\u0430\u043b \u0441\u0435\u0440\u0432\u0435\u0440.",
                detail=detail,
                icon="bi-slash-circle",
            ),
            400,
        )

    @app.errorhandler(InternalServerError)
    def handle_internal_server_error(_err):
        if _request_prefers_json():
            return _json_error(
                "\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.",
                500,
            )
        return (
            _render_error_page(
                500,
                "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d",
                "\u0427\u0442\u043e-\u0442\u043e \u0441\u043b\u043e\u043c\u0430\u043b\u043e\u0441\u044c \u043d\u0430 \u043d\u0430\u0448\u0435\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u0435. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.",
                detail="\u0415\u0441\u043b\u0438 \u043e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0432\u0442\u043e\u0440\u044f\u0435\u0442\u0441\u044f, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0437\u0430\u043d\u043e\u0432\u043e \u0438\u043b\u0438 \u0432\u0435\u0440\u043d\u0438\u0442\u0435\u0441\u044c \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u044d\u043a\u0440\u0430\u043d.",
                icon="bi-cloud-slash",
            ),
            500,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_error(err):
        if isinstance(err, HTTPException):
            return err
        logger.exception("Unhandled application error on %s", request.path)
        if _request_prefers_json():
            return _json_error(
                "\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.",
                500,
            )
        return (
            _render_error_page(
                500,
                "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d",
                "\u0427\u0442\u043e-\u0442\u043e \u0441\u043b\u043e\u043c\u0430\u043b\u043e\u0441\u044c \u043d\u0430 \u043d\u0430\u0448\u0435\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u0435. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.",
                detail="\u0415\u0441\u043b\u0438 \u043e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0432\u0442\u043e\u0440\u044f\u0435\u0442\u0441\u044f, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0437\u0430\u043d\u043e\u0432\u043e \u0438\u043b\u0438 \u0432\u0435\u0440\u043d\u0438\u0442\u0435\u0441\u044c \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u044d\u043a\u0440\u0430\u043d.",
                icon="bi-cloud-slash",
            ),
            500,
        )

