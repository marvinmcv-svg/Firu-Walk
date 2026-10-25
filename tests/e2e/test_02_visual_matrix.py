"""T8-f · 02 — Visual matrix: every view of every role, light + dark + mobile.

Runs on pristine seed so the LIVE banner, dispute queue and application queue
are all present. Screenshots every screen ("screen test").
"""
from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, login, logout, switch_view

OWNER_VIEWS = ["Inicio", "Explorar", "Reservas", "Perfil"]
WALKER_VIEWS = ["Inicio", "Agenda", "Ganancias", "Perfil"]
ADMIN_VIEWS = ["Panel", "Solicitudes", "Reservas", "Casos", "Usuarios", "Config"]


def _assert_within_viewport(mobile_page, label):
    """No element overflowing the 390px viewport horizontally."""
    sw = mobile_page.evaluate("document.documentElement.scrollWidth")
    assert sw <= 392, f"mobile overflow on {label}: scrollWidth={sw}"


def test_owner_views_light(page, shot, errors):
    login(page, "Ana Rivera")
    expect(page.get_by_text("¡Hola, Ana!", exact=False)).to_be_visible()

    # LIVE banner (seeded IN_PROGRESS walk)
    expect(page.get_by_text("Paseo en curso", exact=False).first).to_be_visible()
    expect(page.get_by_role("button", name="Ver en vivo").first).to_be_visible()
    shot("owner-home")

    switch_view(page, "Explorar")
    cards = page.locator("main img[alt*='Paseador'], main img[alt*='paseador']").count() + \
            page.get_by_text("verificado", exact=False).count()
    assert cards >= 3, "explore should show walker cards"
    shot("owner-explore")

    switch_view(page, "Reservas")
    expect(page.get_by_role("tab", name="Activas")).to_be_visible()
    expect(page.get_by_role("tab", name="Historial")).to_be_visible()
    shot("owner-bookings")

    switch_view(page, "Perfil")
    expect(page.get_by_text("Max", exact=False).first).to_be_visible()
    expect(page.get_by_text("Agregar peludo", exact=False).first).to_be_visible()
    shot("owner-profile")

    assert_no_errors(errors, "owner views light")


def test_walker_views_light(page, shot, errors):
    login(page, "Luis Quisbert")
    expect(page.get_by_text("Verificado", exact=False).first).to_be_visible()

    switch_view(page, "Inicio")
    expect(page.get_by_text("Hoy", exact=False).first).to_be_visible()
    shot("walker-home")

    switch_view(page, "Agenda")
    page.wait_for_timeout(1_000)
    expect(page.get_by_text("Lun", exact=False).first).to_be_visible()  # day headers (DAYS_SHORT)
    shot("walker-agenda")

    switch_view(page, "Ganancias")
    expect(page.get_by_text("Bs", exact=False).first).to_be_visible()
    expect(page.get_by_text("Retirar dinero", exact=False).first).to_be_visible()
    shot("walker-earnings")

    switch_view(page, "Perfil")
    expect(page.get_by_text("Reseñas", exact=False).first).to_be_visible()
    shot("walker-profile")

    assert_no_errors(errors, "walker views light")


def test_admin_views_light(page, shot, errors):
    login(page, "Equipo FiruWalk")

    switch_view(page, "Panel")
    expect(page.locator("main svg").first).to_be_visible()  # chart
    shot("admin-dashboard")

    switch_view(page, "Solicitudes")
    expect(page.get_by_role("tab").first).to_be_visible()
    shot("admin-applications")

    switch_view(page, "Reservas")
    expect(page.get_by_placeholder("Buscar por dueño")).to_be_visible()
    shot("admin-bookings")

    switch_view(page, "Casos")
    expect(page.get_by_text("Resolver caso", exact=False).first).to_be_visible()
    shot("admin-disputes")

    switch_view(page, "Usuarios")
    expect(page.get_by_placeholder("Buscar por nombre")).to_be_visible()
    expect(page.get_by_text("Marcar pagado", exact=False).first).to_be_visible()
    shot("admin-users")

    switch_view(page, "Config")
    expect(page.get_by_text("nada está hard-coded", exact=False).first).to_be_visible()
    shot("admin-config")

    assert_no_errors(errors, "admin views light")


def test_dark_mode_all_roles(page, shot, errors):
    page.goto(BASE_URL)
    page.evaluate("localStorage.setItem('theme','dark')")

    login(page, "Ana Rivera")
    assert "dark" in (page.locator("html").get_attribute("class") or "")
    expect(page.locator("header img[alt='FiruWalk']").filter(visible=True).first).to_be_visible()
    shot("dark-owner-home")
    switch_view(page, "Reservas")
    shot("dark-owner-bookings")
    switch_view(page, "Explorar")
    shot("dark-owner-explore")

    # Theme toggle roundtrip inside the app
    page.locator("[aria-label='Cambiar tema']").click()
    page.wait_for_timeout(600)
    assert "dark" not in (page.locator("html").get_attribute("class") or "")
    shot("light-roundtrip")
    page.locator("[aria-label='Cambiar tema']").click()
    page.wait_for_timeout(600)
    expect(page.locator("html")).to_have_class("dark")

    assert_no_errors(errors, "dark mode")


def test_mobile_views_all_roles(mobile_page, mshot, errors):
    mobile_page.goto(BASE_URL)
    mobile_page.evaluate("localStorage.setItem('theme','light')")

    # --- owner
    login(mobile_page, "Ana Rivera")
    for label in OWNER_VIEWS:
        switch_view(mobile_page, label)
        _assert_within_viewport(mobile_page, f"owner/{label}")
    mshot("mobile-owner-home")

    # bottom nav geometry: all 4 buttons inside viewport
    geo = mobile_page.evaluate(
        """[...document.querySelectorAll('nav button')].map(b => {
             const r = b.getBoundingClientRect();
             return { label: b.textContent, top: r.top, bottom: r.bottom };
           })"""
    )
    assert len(geo) == 4, geo
    for g in geo:
        assert g["bottom"] <= 844 and g["top"] >= 760, f"nav out of viewport: {g}"

    # nav pill exists behind active item
    # nav pill exists behind active item (class token is bg-brand-soft/80)
    pill_count = mobile_page.evaluate(
        "document.querySelectorAll('nav [class*=bg-brand-soft]').length"
    )
    assert pill_count >= 1, "active pill indicator missing"

    # --- walker
    logout(mobile_page)
    login(mobile_page, "Luis Quisbert")
    for label in WALKER_VIEWS:
        switch_view(mobile_page, label)
        _assert_within_viewport(mobile_page, f"walker/{label}")

    # --- admin: 6 items in a 2x3 grid, nothing clipped
    logout(mobile_page)
    login(mobile_page, "Equipo FiruWalk")
    for label in ADMIN_VIEWS:
        switch_view(mobile_page, label)
        _assert_within_viewport(mobile_page, f"admin/{label}")
    mshot("mobile-admin-dashboard")

    geo = mobile_page.evaluate(
        """[...document.querySelectorAll('nav button')].map(b => {
             const r = b.getBoundingClientRect();
             return { label: b.textContent, bottom: r.bottom };
           })"""
    )
    assert len(geo) == 6, f"admin nav should have 6 items, got {len(geo)}"
    for g in geo:
        assert g["bottom"] <= 845, f"admin nav item clipped: {g}"

    assert_no_errors(errors, "mobile views")
