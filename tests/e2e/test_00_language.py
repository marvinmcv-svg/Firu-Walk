"""T9 · 00 — Language toggle: ES ⇄ EN end-to-end.

Journey: landing (ES default → EN → persistence) → owner app in EN → back to
ES in-app → walker app in EN → admin app in EN (EN money decimals) → ES +
logout. Plus a 390px mobile pass: the toggle stays visible/tappable and the
header never overflows.
"""
from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors


def _toggle(page, seg: str):
    """Click the ES/EN segmented control (stable accessible names)."""
    page.get_by_role("button", name=seg, exact=True).first.click()
    page.wait_for_timeout(800)


def _login_en(page, account: str):
    """Open the EN login dialog and pick a demo account."""
    page.get_by_role("button", name="Sign in").first.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Sign in to FiruWalk")
    dlg.get_by_text(account, exact=False).first.click()
    page.wait_for_timeout(2_500)


def _nav_visible(page, labels: list[str]):
    for label in labels:
        expect(
            page.get_by_role("button", name=label, exact=True).filter(visible=True).first
        ).to_be_visible()


def test_language_toggle_full_journey(page, shot, errors):
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(1_200)

    # --- fresh context defaults to Spanish
    expect(page.get_by_role("button", name="Ingresar")).to_be_visible()
    expect(page.locator("header").get_by_role("link", name="Cómo funciona")).to_be_visible()
    assert page.evaluate("document.documentElement.lang") in ("es-BO", "es")

    # --- toggle to EN on the landing
    _toggle(page, "EN")
    for link in ["How it works", "Trust", "Areas"]:
        expect(page.locator("header").get_by_role("link", name=link)).to_be_visible()
    expect(page.get_by_role("button", name="Sign in").first).to_be_visible()
    expect(page.get_by_role("button", name="I'm a walker")).to_be_visible()
    expect(page.get_by_role("heading", level=1)).to_contain_text("Happy walks")
    expect(page.get_by_role("heading", level=1)).to_contain_text("worry-free owners")
    expect(page.get_by_role("button", name="Book a walk")).to_be_visible()
    assert page.evaluate("document.documentElement.lang") == "en"
    shot("landing-en")

    # --- the choice persists across a reload
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1_200)
    expect(page.get_by_role("button", name="Sign in").first).to_be_visible()
    assert page.evaluate("document.documentElement.lang") == "en"

    # --- login dialog in EN (demo-account subtitles are server data, stay ES)
    page.get_by_role("button", name="Sign in").first.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Sign in to FiruWalk")
    expect(dlg).to_contain_text("Ana Rivera")
    expect(dlg.get_by_text("Phone number")).to_be_visible()
    shot("login-dialog-en")

    # --- owner app fully in EN
    dlg.get_by_text("Ana Rivera", exact=False).first.click()
    page.wait_for_timeout(2_500)
    _nav_visible(page, ["Home", "Explore", "Bookings", "Profile"])
    expect(page.locator("[aria-label='Notifications']")).to_be_visible()
    expect(page.get_by_role("heading", level=1)).to_contain_text("Hi, Ana!")
    expect(page.get_by_role("heading", name="Upcoming walks")).to_be_visible()
    expect(page.get_by_role("button", name="Watch live")).to_be_visible()
    shot("owner-en")

    # --- toggle back to ES inside the app
    _toggle(page, "ES")
    _nav_visible(page, ["Inicio", "Explorar", "Reservas", "Perfil"])
    expect(page.locator("[aria-label='Notificaciones']")).to_be_visible()
    expect(page.get_by_role("heading", level=1)).to_contain_text("¡Hola, Ana!")
    expect(page.get_by_role("heading", name="Próximos paseos")).to_be_visible()
    assert page.evaluate("document.documentElement.lang") in ("es-BO", "es")
    shot("owner-es")

    # --- logout (ES chrome) → walker app in EN
    page.locator("header button:has(img)").last.click()
    page.get_by_role("menuitem", name="Cerrar sesión").click()
    page.wait_for_timeout(1_200)
    expect(page.get_by_role("button", name="Ingresar")).to_be_visible()
    _toggle(page, "EN")
    _login_en(page, "Luis Quisbert")
    _nav_visible(page, ["Home", "Schedule", "Earnings", "Profile"])
    expect(
        page.get_by_role("button", name="Resume walk").filter(visible=True).first
    ).to_be_visible()
    expect(page.get_by_role("heading", level=1)).to_contain_text("Hi, Luis!")
    shot("walker-en")

    # --- admin app in EN (money switches to EN decimals: "Bs 15.00")
    page.locator("header button:has(img)").last.click()
    page.get_by_role("menuitem", name="Log out").click()
    page.wait_for_timeout(1_200)
    _login_en(page, "Equipo FiruWalk")
    _nav_visible(page, ["Dashboard", "Applications", "Bookings", "Cases", "Users", "Config"])
    expect(page.get_by_role("heading", name="Operations dashboard")).to_be_visible()
    expect(page.get_by_text("Bs 15.00", exact=False).first).to_be_visible()
    shot("admin-en")

    # --- final flip to ES: chrome + admin dashboard revert, then logout
    _toggle(page, "ES")
    _nav_visible(page, ["Panel", "Solicitudes", "Reservas", "Casos", "Usuarios", "Config"])
    expect(page.get_by_text("Panel de operaciones", exact=False).first).to_be_visible()
    expect(page.get_by_text("Bs 15,00", exact=False).first).to_be_visible()
    page.locator("header button:has(img)").last.click()
    page.get_by_role("menuitem", name="Cerrar sesión").click()
    page.wait_for_timeout(1_200)
    expect(page.get_by_role("button", name="Ingresar")).to_be_visible()
    expect(page.locator("header").get_by_role("link", name="Cómo funciona")).to_be_visible()
    shot("landing-es-restored")

    assert_no_errors(errors, "language toggle full journey")


def test_language_toggle_mobile(mobile_page, mshot, errors):
    """390px: toggle visible + tappable, secondary CTA yields, no overflow."""
    mobile_page.goto(BASE_URL, wait_until="networkidle")
    mobile_page.wait_for_timeout(1_500)

    # Spanish default + toggle visible on mobile
    expect(mobile_page.get_by_role("button", name="Ingresar")).to_be_visible()
    expect(mobile_page.get_by_role("button", name="EN", exact=True).first).to_be_visible()

    # Toggle to EN with a touch tap
    _toggle(mobile_page, "EN")
    expect(mobile_page.get_by_role("button", name="Sign in").first).to_be_visible()
    expect(mobile_page.get_by_role("heading", level=1)).to_contain_text("Happy walks")

    # No horizontal overflow at 390px with the toggle in the header
    sw = mobile_page.evaluate("document.documentElement.scrollWidth")
    assert sw <= 392, f"horizontal overflow: scrollWidth={sw}"
    mshot("landing-en-mobile")

    # Login flow works in EN on mobile too
    mobile_page.get_by_role("button", name="Sign in").first.click()
    dlg = mobile_page.get_by_role("dialog")
    expect(dlg).to_contain_text("Sign in to FiruWalk")
    dlg.get_by_text("Ana Rivera", exact=False).first.click()
    mobile_page.wait_for_timeout(2_500)
    # Bottom tab bar is the visible nav on mobile
    for label in ["Home", "Explore", "Bookings", "Profile"]:
        expect(
            mobile_page.get_by_role("button", name=label, exact=True).filter(visible=True).first
        ).to_be_visible()
    mshot("owner-en-mobile")

    assert_no_errors(errors, "language toggle mobile")
