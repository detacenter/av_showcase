from __future__ import annotations

import os
import json
import time
import base64
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

import requests

from integrations import api_metrics

TOKEN_FILE = ".spotify_token.json"
AUTH_STATUS_FILE = ".spotify_auth_status.json"
SCOPE = "user-read-recently-played user-read-playback-state"


class SpotifyAuthExpired(Exception):
    """Raised when the refresh token itself is no longer valid (invalid_grant)."""


def _save_tokens(data: dict) -> None:
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _load_tokens() -> dict | None:
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            return json.load(f)
    return None


def _discard_tokens() -> None:
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)


def _set_needs_reauth(value: bool) -> None:
    with open(AUTH_STATUS_FILE, "w") as f:
        json.dump({"needs_reauth": value}, f, indent=2)


def needs_reauth() -> bool:
    if not os.path.exists(AUTH_STATUS_FILE):
        return False
    try:
        with open(AUTH_STATUS_FILE) as f:
            return bool(json.load(f).get("needs_reauth", False))
    except (json.JSONDecodeError, OSError):
        return False


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    return "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()


def _exchange(client_id: str, client_secret: str, data: dict) -> dict:
    resp = api_metrics.post(
        "Spotify",
        "token_exchange",
        "https://accounts.spotify.com/api/token",
        headers={"Authorization": _basic_auth_header(client_id, client_secret)},
        data=data,
    )
    resp.raise_for_status()
    payload = resp.json()
    tokens = {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token", data.get("refresh_token")),
        "expires_at": time.time() + payload["expires_in"],
    }
    _save_tokens(tokens)
    return tokens


def _refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    try:
        tokens = _exchange(
            client_id, client_secret,
            {"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
    except requests.exceptions.HTTPError as e:
        resp = e.response
        is_invalid_grant = False
        if resp is not None and resp.status_code == 400:
            try:
                is_invalid_grant = resp.json().get("error") == "invalid_grant"
            except (json.JSONDecodeError, ValueError):
                pass
        if is_invalid_grant:
            _discard_tokens()
            _set_needs_reauth(True)
            raise SpotifyAuthExpired() from e
        raise
    return tokens["access_token"]


def _run_auth_flow(client_id: str, client_secret: str, redirect_uri: str) -> str:
    captured = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in params:
                captured["code"] = params["code"][0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<html><body><p>Authenticated. You can close this tab.</p></body></html>")

        def log_message(self, *_):
            pass  # suppress server logs

    parsed = urllib.parse.urlparse(redirect_uri)
    port = parsed.port or 3000

    auth_url = _build_authorize_url(client_id, redirect_uri)

    print("Opening browser for Spotify authentication...")
    print(f"If it doesn't open automatically, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    server.handle_request()
    server.server_close()

    if "code" not in captured:
        raise RuntimeError("Authorization failed: no code received.")

    tokens = _exchange(
        client_id, client_secret,
        {"grant_type": "authorization_code", "code": captured["code"], "redirect_uri": redirect_uri},
    )
    print("Authenticated successfully.\n")
    return tokens["access_token"]


def _build_authorize_url(client_id: str, redirect_uri: str) -> str:
    return "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
    })


def build_authorize_url() -> str:
    """Build the Spotify consent URL for the Electron-driven reauth flow."""
    client_id = os.environ["SPOTIFY_CLIENT_ID"]
    redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:3000/callback")
    return _build_authorize_url(client_id, redirect_uri)


def exchange_code(code: str) -> str:
    """Exchange an authorization code (captured by Electron's redirect interception) for tokens."""
    client_id = os.environ["SPOTIFY_CLIENT_ID"]
    client_secret = os.environ["SPOTIFY_CLIENT_SECRET"]
    redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:3000/callback")
    tokens = _exchange(
        client_id, client_secret,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
    )
    _set_needs_reauth(False)
    return tokens["access_token"]


def get_access_token() -> str:
    client_id = os.environ["SPOTIFY_CLIENT_ID"]
    client_secret = os.environ["SPOTIFY_CLIENT_SECRET"]
    redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:3000/callback")

    tokens = _load_tokens()
    if tokens:
        if time.time() < tokens["expires_at"] - 60:
            return tokens["access_token"]
        return _refresh_access_token(client_id, client_secret, tokens["refresh_token"])

    return _run_auth_flow(client_id, client_secret, redirect_uri)
