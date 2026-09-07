#!/usr/bin/env python3
"""本地兴趣点编辑服务：只监听本机，并把修改写回仓库。"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import sys
import threading
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
POIS_FILE = ROOT / "map" / "pois.json"
MEDIA_DIR = ROOT / "map" / "media"
HOST = "127.0.0.1"
MAX_BODY = 50 * 1024 * 1024
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class PoiHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write("[地图编辑器] " + fmt % args + "\n")

    def _json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("无效的请求长度") from exc
        if length <= 0 or length > MAX_BODY:
            raise ValueError("请求为空或文件过大")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/api/health":
            self._json_response(200, {"ok": True})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            payload = self._read_json()
            if path == "/api/pois":
                self._save_pois(payload)
            elif path == "/api/upload":
                self._save_upload(payload)
            else:
                self._json_response(404, {"error": "未知接口"})
        except (ValueError, json.JSONDecodeError, OSError) as exc:
            self._json_response(400, {"error": str(exc)})

    def _save_pois(self, payload: dict) -> None:
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError("兴趣点文件格式不正确")
        points = payload.get("points")
        if not isinstance(points, list):
            raise ValueError("points 必须是数组")
        seen = set()
        for point in points:
            if not isinstance(point, dict):
                raise ValueError("兴趣点内容不正确")
            point_id = point.get("id")
            if not isinstance(point_id, str) or not point_id or point_id in seen:
                raise ValueError("兴趣点 ID 缺失或重复")
            if not isinstance(point.get("title"), str) or not point["title"].strip():
                raise ValueError("每个兴趣点都需要名称")
            if not isinstance(point.get("x"), (int, float)) or not isinstance(point.get("z"), (int, float)):
                raise ValueError("兴趣点坐标不正确")
            seen.add(point_id)

        temp_file = POIS_FILE.with_suffix(".json.tmp")
        temp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp_file, POIS_FILE)
        self._json_response(200, {"ok": True, "count": len(points)})

    def _save_upload(self, payload: dict) -> None:
        poi_id = str(payload.get("poiId", ""))
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", poi_id):
            raise ValueError("兴趣点 ID 不正确")
        data_url = payload.get("data")
        if not isinstance(data_url, str) or "," not in data_url:
            raise ValueError("图片内容不正确")
        header, encoded = data_url.split(",", 1)
        media_type = header.removeprefix("data:").split(";", 1)[0]
        extension = ALLOWED_TYPES.get(media_type)
        if not extension:
            raise ValueError("只支持 PNG、JPEG、WebP 或 GIF 图片")
        try:
            content = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise ValueError("图片编码不正确") from exc
        if not content or len(content) > MAX_BODY:
            raise ValueError("图片为空或过大")

        original_stem = Path(str(payload.get("filename", "image"))).stem
        safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "-", original_stem).strip("-")[:40] or "image"
        folder = MEDIA_DIR / poi_id
        folder.mkdir(parents=True, exist_ok=True)
        filename = f"{safe_stem}-{uuid.uuid4().hex[:8]}{extension}"
        (folder / filename).write_bytes(content)
        public_path = f"../map/media/{poi_id}/{filename}"
        self._json_response(200, {"ok": True, "path": public_path})


def main() -> None:
    mimetypes.add_type("image/webp", ".webp")
    server = ThreadingHTTPServer((HOST, 0), PoiHandler)
    port = server.server_address[1]
    url = f"http://{HOST}:{port}/map/editor.html"
    print(f"兴趣点编辑器已启动：{url}")
    print("关闭此窗口或按 Ctrl+C 即可停止。")
    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n编辑器已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
