"""Small synchronous client for Orbit Identity's native REST API."""

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from typing import Any


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib invokes this override positionally; preserve its callback signature.
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class IdentityApiError(Exception):
    def __init__(self, *, status: int, code: str, request_id: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id


class IdentityClient:
    def __init__(self, *, origin: str, token: str | None = None, timeout: float = 5.0) -> None:
        parsed = urllib.parse.urlsplit(origin)
        if parsed.username or parsed.password or (
            parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"))
        ):
            raise ValueError("Use HTTPS or a loopback development origin")
        if not 0 < timeout <= 60:
            raise ValueError("Timeout must be between zero and sixty seconds")
        if token is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", token):
            raise ValueError("Invalid bearer token")
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        self.token = token
        self.timeout = timeout

    def request(self, *, path: str) -> dict[str, Any]:
        if not path.startswith("/") or "\r" in path or "\n" in path or len(path) > 4_096:
            raise ValueError("Use a bounded API-relative path")
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(self.origin + "/api/v1" + path, headers=headers)
        for attempt in range(3):
            try:
                opener = urllib.request.build_opener(_NoRedirect())
                with opener.open(request, timeout=self.timeout) as response:
                    if urllib.parse.urlsplit(response.url).netloc != urllib.parse.urlsplit(self.origin).netloc:
                        raise ValueError("Cross-origin redirect rejected")
                    body = response.read(2_097_153)
                    if len(body) > 2_097_152:
                        raise IdentityApiError(status=response.status, code="RESPONSE_TOO_LARGE", request_id="", message="Response exceeds two MiB")
                    try:
                        return json.loads(body)
                    except (ValueError, UnicodeError) as error:
                        raise IdentityApiError(status=response.status, code="INVALID_RESPONSE", request_id="", message="Invalid JSON response") from error
            except urllib.error.HTTPError as error:
                if error.code >= 500 and attempt < 2:
                    time.sleep(0.1 * 2**attempt)
                    continue
                raw = error.read(2_097_153)
                try:
                    body = json.loads(raw) if len(raw) <= 2_097_152 else {}
                except (ValueError, UnicodeError):
                    body = {}
                raise IdentityApiError(
                    status=error.code,
                    code=body.get("code", body.get("error", "REQUEST_FAILED")),
                    request_id=body.get("request_id", ""),
                    message=body.get("message", body.get("error_description", "Request failed")),
                ) from error
            except (TimeoutError, socket.timeout) as error:
                raise IdentityApiError(status=0, code="TIMEOUT", request_id="", message="Request timed out") from error
            except urllib.error.URLError as error:
                raise IdentityApiError(status=0, code="TRANSPORT_ERROR", request_id="", message="Connection unavailable") from error
        raise RuntimeError("Request exhausted retries")

    def profile(self, *, identifier: str, persona: str | None = None) -> dict[str, Any]:
        path = "/profiles/" + urllib.parse.quote(identifier, safe="")
        if persona:
            path += "?persona=" + urllib.parse.quote(persona, safe="")
        return self.request(path=path)

    def resolve(self, *, identifier_type: str, identifier: str) -> dict[str, Any]:
        if identifier_type not in ("native", "domain", "email", "github", "did"):
            raise ValueError("Unsupported resolver type")
        return self.request(path="/resolve?" + urllib.parse.urlencode({"type": identifier_type, "identifier": identifier}))

    def oauth_profile(self) -> dict[str, Any]:
        return self.request(path="/oauth/profile")

    def oauth_credentials(self) -> dict[str, Any]:
        return self.request(path="/oauth/credentials")

    def consented_profile(self) -> dict[str, Any]:
        return self.request(path="/application/profile")

    def search(self, *, term: str) -> Iterator[dict[str, Any]]:
        cursor = ""
        seen: set[str] = set()
        while True:
            path = "/search?" + urllib.parse.urlencode({"q": term, "cursor": cursor})
            page = self.request(path=path)
            yield from page["items"]
            cursor = page.get("nextCursor")
            if not cursor:
                return
            if cursor in seen:
                raise IdentityApiError(status=0, code="INVALID_CURSOR", request_id="", message="Repeated pagination cursor")
            seen.add(cursor)
