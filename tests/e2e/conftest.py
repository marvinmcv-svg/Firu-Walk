"""FiruWalk E2E suite — shared fixtures & helpers.

Run through a gateway that routes `?XTransformPort=3003` to the live-service
and everything else to the Next.js app (default http://localhost:81).
Env overrides: BASE_URL, CHROMIUM_PATH (use a preinstalled Chromium binary).
"""
import datetime
import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

BASE_URL = os.environ.get("BASE_URL", "http://localhost:81")
SHOT_DIR = Path(__file__).parent / "screenshots"

# Console noise that is NOT an app defect (map tiles are external, HMR is dev-mode).
NOISE = [
    "openstreetmap", "tile", "net::ERR", "Failed to load resource",
    "webpack", "WebSocket connection failed", "React DevTools",
    "Download the React", "sourcemap", "favicon",
]


def is_noise(msg: str) -> bool:
    return any(p.lower() in msg.lower() for p in NOISE)


# Skip the hyperframes intro splash for every standard fixture — it has its own
# dedicated coverage in test_06_firulai_intro.py (fresh context, no init script).
# add_init_script runs before page scripts on EVERY navigation in the context.
SKIP_INTRO = "try{sessionStorage.setItem('firu-intro-played','1')}catch(e){}"


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        yield browser
        browser.close()


@pytest.fixture
def errors():
    """List of real console/page errors observed during a test."""
    return []


@pytest.fixture
def page(browser, errors):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    context.add_init_script(SKIP_INTRO)
    page = context.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and not is_noise(m.text)
        else None,
    )
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}") if not is_noise(str(e)) else None)
    page.set_default_timeout(20_000)
    yield page
    context.close()


@pytest.fixture
def mobile_page(browser, errors):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    context.add_init_script(SKIP_INTRO)
    page = context.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and not is_noise(m.text)
        else None,
    )
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}") if not is_noise(str(e)) else None)
    page.set_default_timeout(20_000)
    yield page
    context.close()


class Shot:
    """Screenshot helper bound to one test file."""

    def __init__(self, page: Page, name: str):
        self.page = page
        self.dir = SHOT_DIR / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.n = 0

    def __call__(self, label: str, full: bool = False):
        self.n += 1
        path = self.dir / f"{self.n:02d}_{re.sub(r'[^a-z0-9]+', '_', label.lower())}.png"
        self.page.screenshot(path=str(path), full_page=full)
        return path


@pytest.fixture
def shot(page, request):
    return Shot(page, request.node.originalname if hasattr(request.node, "originalname") else "test")


@pytest.fixture
def mshot(mobile_page, request):
    return Shot(mobile_page, request.node.originalname)


def login(page: Page, account_name: str):
    """Login through the demo-account dialog."""
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(400)  # settle after hydration
    page.get_by_role("button", name="Ingresar").first.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Entra a FiruWalk")
    dlg.get_by_text(account_name, exact=False).first.click()
    # App shell appears: notification bell + a visible brand logo (light or dark variant)
    expect(page.locator("[aria-label='Notificaciones']")).to_be_visible()
    expect(
        page.locator("header img[alt='FiruWalk']").filter(visible=True).first
    ).to_be_visible()
    page.wait_for_timeout(1_200)


def logout(page: Page):
    page.locator("header button:has(img)").last.click()
    page.get_by_role("menuitem", name="Cerrar sesión").click()
    expect(page.get_by_role("button", name="Ingresar").first).to_be_visible()
    page.wait_for_timeout(600)


def next_saturday() -> str:
    """ISO date of the next Saturday (at least 6 days out)."""
    d = datetime.date.today()
    days_ahead = (5 - d.weekday()) % 7  # Saturday = weekday 5
    if days_ahead < 6:
        days_ahead += 7
    return (d + datetime.timedelta(days=days_ahead)).isoformat()


def switch_view(page: Page, label: str):
    """Click a nav destination — the visible one (sidebar on lg, bottom nav on mobile)."""
    page.get_by_role("button", name=label, exact=True).filter(visible=True).first.click()
    page.wait_for_timeout(900)


def assert_no_errors(errors, where: str):
    real = [e for e in errors if not is_noise(e)]
    assert not real, f"console/page errors in {where}: {real}"
