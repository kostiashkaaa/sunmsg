"""Sanitize uploaded images: strip metadata (EXIF/XMP/IPTC/ICC GPS),
guard against decompression bombs, and re-encode to a clean payload.

Why re-encode and not just strip EXIF in place?
- Polyglot files (valid PNG + appended ZIP/JS) survive header-level metadata
  strip. Decode → re-encode produces a clean bytestream without the trailing
  payload.
- `image.info.pop('exif')` only handles a subset; XMP/IPTC chunks remain
  in PNG/WebP otherwise.

The sanitizer fails closed: if Pillow can't load the image (or the image
exceeds size/pixel limits), the file is rejected at the upload route — we
never silently bypass.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# 50 megapixels — enough for 8K photos, blocks 50000x50000 decompression bombs.
# Pillow default is 89 megapixels; we tighten because this is user-uploaded.
MAX_IMAGE_PIXELS = 50 * 1024 * 1024  # 50M

# Pillow modes we accept. Anything else (e.g. CMYK, LAB) gets converted to RGB.
_PASS_THROUGH_MODES = {"RGB", "RGBA", "L", "LA", "P"}

# Extensions whose pixel data we can safely re-encode through Pillow.
SANITIZABLE_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "gif", "webp", "bmp"})

# Map sanitized extension → Pillow format name.
_PILLOW_FORMAT_BY_EXT = {
    "png": "PNG",
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "gif": "GIF",
    "webp": "WEBP",
    "bmp": "BMP",
}


class ImageSanitizationError(Exception):
    """Raised when an uploaded image cannot be sanitized safely."""


def is_sanitizable_extension(ext: str) -> bool:
    return str(ext or "").strip().lower() in SANITIZABLE_EXTENSIONS


def _flatten_palette_if_needed(image, target_format: str):
    """JPEG cannot save P/RGBA — flatten to RGB on white background."""
    if target_format != "JPEG":
        return image
    if image.mode in {"RGB", "L"}:
        return image
    from PIL import Image as _PILImage  # local import for type stability

    if image.mode == "RGBA":
        background = _PILImage.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        return background
    return image.convert("RGB")


def sanitize_image_to_path(
    src_stream,
    dest_path: str,
    *,
    ext: str,
    max_pixels: int = MAX_IMAGE_PIXELS,
) -> int:
    """Decode image from `src_stream`, drop metadata, re-encode to `dest_path`.

    Returns the new file size in bytes. Raises `ImageSanitizationError` if the
    image can't be decoded, is too large, or the extension is unsupported.
    The destination is written atomically (write to .tmp then rename).

    The source stream is rewound on both success and failure.
    """
    normalized_ext = str(ext or "").strip().lower()
    if normalized_ext not in SANITIZABLE_EXTENSIONS:
        raise ImageSanitizationError(f"unsupported_extension:{normalized_ext}")

    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise ImageSanitizationError("pillow_not_installed") from exc

    try:
        src_stream.seek(0)
    except (OSError, ValueError) as exc:
        raise ImageSanitizationError("source_not_seekable") from exc

    # Pillow's MAX_IMAGE_PIXELS is a soft warning; we enforce hard.
    previous_pixel_cap = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = int(max_pixels) + 1

    target_format = _PILLOW_FORMAT_BY_EXT[normalized_ext]
    tmp_path = f"{dest_path}.sanitize.tmp"

    try:
        with Image.open(src_stream) as image:
            # Force decode so a truncated/corrupt payload raises here, not later.
            image.load()

            width, height = image.size
            if width <= 0 or height <= 0 or width * height > int(max_pixels):
                raise ImageSanitizationError(
                    f"image_too_large:{width}x{height}"
                )

            if image.mode not in _PASS_THROUGH_MODES:
                image = image.convert("RGB")

            image = _flatten_palette_if_needed(image, target_format)

            save_kwargs: dict = {"format": target_format}
            if target_format == "JPEG":
                save_kwargs.update({"quality": 88, "optimize": True, "progressive": True})
            elif target_format == "PNG":
                save_kwargs.update({"optimize": True})
            elif target_format == "WEBP":
                save_kwargs.update({"quality": 88, "method": 4})
            elif target_format == "GIF":
                # Preserve animation frames; Pillow drops metadata by default
                # on re-save.
                save_kwargs.update({"save_all": getattr(image, "is_animated", False)})

            with open(tmp_path, "wb") as fh:
                image.save(fh, **save_kwargs)

        # Atomic-ish replace; on Windows os.replace overwrites.
        os.replace(tmp_path, dest_path)
        return os.path.getsize(dest_path)
    except ImageSanitizationError:
        _quiet_remove(tmp_path)
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, MemoryError) as exc:
        _quiet_remove(tmp_path)
        logger.info("Image sanitization rejected payload: %s", exc)
        raise ImageSanitizationError("decode_failed") from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_pixel_cap
        try:
            src_stream.seek(0)
        except (OSError, ValueError):
            pass


def _quiet_remove(path: Optional[str]) -> None:
    if not path:
        return
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def sanitize_inplace(file_path: str, *, ext: str, max_pixels: int = MAX_IMAGE_PIXELS) -> int:
    """Re-encode an already-saved file in place, stripping metadata.

    Used by upload routes that save first and validate second. The original
    file is replaced atomically on success. Returns the new size in bytes.
    """
    if not file_path or not os.path.exists(file_path):
        raise ImageSanitizationError("source_missing")
    with open(file_path, "rb") as src:
        return sanitize_image_to_path(src, file_path, ext=ext, max_pixels=max_pixels)
