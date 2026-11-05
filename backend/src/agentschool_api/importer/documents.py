"""Text extraction and chunking for bulk document ingestion (SPEC.md §9)."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass


class DocumentError(ValueError):
    pass


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    heading: str | None
    text: str


def extract_text(data: bytes, media_type: str) -> str:
    if media_type in ("text/markdown", "text/plain"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DocumentError("text payload is not valid UTF-8") from exc
    elif media_type == "application/pdf":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise DocumentError("PDF is encrypted")
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
        except PdfReadError as exc:
            raise DocumentError(f"PDF could not be read: {exc}") from exc
        if len(text.strip()) < 20:
            raise DocumentError("PDF has no extractable text (scanned PDFs are not OCR'd in v1)")
    else:
        raise DocumentError(f"unsupported media type {media_type}")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def chunk_text(text: str, max_chars: int = 1500, markdown: bool = True) -> list[Chunk]:
    """Split into chunks of at most `max_chars`, on Markdown headings first, then paragraphs, then sentences.

    Each chunk remembers the nearest heading, so search results can say where they come from.
    """
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in text.split("\n"):
        m = _HEADING.match(line) if markdown else None
        if m:
            sections.append((m.group(2).strip()[:300], []))
        else:
            sections[-1][1].append(line)

    chunks: list[Chunk] = []

    def emit(heading: str | None, body: str) -> None:
        body = body.strip()
        if body:
            chunks.append(Chunk(len(chunks), heading, body))

    for heading, lines in sections:
        paragraphs = [p.strip() for p in "\n".join(lines).split("\n\n") if p.strip()]
        buf = ""
        for para in paragraphs:
            pieces = [para] if len(para) <= max_chars else _split_long(para, max_chars)
            for piece in pieces:
                if buf and len(buf) + 2 + len(piece) > max_chars:
                    emit(heading, buf)
                    buf = piece
                else:
                    buf = f"{buf}\n\n{piece}" if buf else piece
        emit(heading, buf)
    return chunks


def _split_long(para: str, max_chars: int) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", para)
    out, buf = [], ""
    for s in sentences:
        while len(s) > max_chars:  # a single enormous "sentence": hard split
            out.append(s[:max_chars])
            s = s[max_chars:]
        if buf and len(buf) + 1 + len(s) > max_chars:
            out.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}" if buf else s
    if buf:
        out.append(buf)
    return out
