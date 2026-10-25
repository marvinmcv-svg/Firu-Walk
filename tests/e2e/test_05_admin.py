"""T8-f · 05 — Admin operations: dashboard, applications, bookings, disputes,
users/payouts, config (with a verified save + revert), CSV exports.
"""
from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, login, logout, switch_view


def test_admin_operations(page, shot, errors):
    login(page, "Equipo FiruWalk")

    # ---------- dashboard ----------
    switch_view(page, "Panel")
    expect(page.locator("main svg").first).to_be_visible()
    expect(page.get_by_text("Zona", exact=False).first).to_be_visible()
    shot("01-dashboard")
    kpis = page.locator("main .text-2xl, main .text-3xl")
    assert kpis.count() >= 4, "dashboard KPIs missing"

    # ---------- applications: tabs + approve dialog (cancelled, no mutation) ----------
    switch_view(page, "Solicitudes")
    page.wait_for_timeout(800)
    shot("02-applications")
    tabs = page.get_by_role("tab")
    assert tabs.count() >= 2
    approve_btn = page.get_by_role("button", name="Aprobar", exact=False).first
    if approve_btn.count():
        approve_btn.click()
        dlg = page.get_by_role("alertdialog")
        expect(dlg).to_be_visible()
        shot("03-approve-dialog")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    # ---------- bookings: search + status filter + row sheet ----------
    switch_view(page, "Reservas")
    search = page.get_by_placeholder("Buscar por dueño")
    expect(search).to_be_visible()
    search.fill("rocky")
    page.wait_for_timeout(800)
    shot("04-bookings-search")
    rows = page.locator("main table tbody tr")
    assert rows.count() <= 2, f"search 'rocky' should be narrow, got {rows.count()} rows"
    search.fill("")
    page.wait_for_timeout(500)

    # status Select
    page.get_by_role("combobox").first.click()
    page.wait_for_timeout(400)
    page.get_by_role("option", name="Confirmadas").click()
    page.wait_for_timeout(800)
    shot("05-bookings-confirmed")

    # row detail Sheet
    page.locator("main table tbody tr").first.click()
    page.wait_for_timeout(900)
    expect(page.get_by_role("dialog")).to_be_visible()
    shot("06-booking-sheet")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # export links exist
    expect(page.get_by_role("button", name="Exportar CSV").first).to_be_visible()

    # ---------- disputes: resolver dialog defaults, cancelled ----------
    switch_view(page, "Casos")
    page.wait_for_timeout(800)
    shot("07-disputes")
    resolve_btn = page.get_by_role("button", name="Resolver caso").first
    if resolve_btn.count():
        resolve_btn.click()
        dlg = page.get_by_role("dialog")
        expect(dlg).to_contain_text("Resolver caso")
        shot("08-resolver-dialog")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    # ---------- users + payouts queue ----------
    switch_view(page, "Usuarios")
    expect(page.get_by_text("Marcar pagado", exact=False).first).to_be_visible()
    shot("09-users")
    usearch = page.get_by_placeholder("Buscar por nombre")
    usearch.fill("Luis")
    page.wait_for_timeout(600)
    shot("10-users-search")
    usearch.fill("")

    # ---------- config: edit commission 12 → 13 → save → verify → revert ----------
    switch_view(page, "Config")
    page.wait_for_timeout(800)
    shot("11-config")
    # first decimal field in DOM order = commissionPct (fees is the first section)
    pct_input = page.locator("input[inputmode='decimal']").nth(0)
    original = pct_input.input_value()
    assert original == "12", f"expected commission 12, got {original}"
    pct_input.fill("13")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Guardar cambios").first.click()
    page.wait_for_timeout(1_200)
    shot("12-config-saved")
    cfg = page.evaluate(
        "fetch('/api/config').then(r => r.json())"
    )
    assert cfg["fees"]["commissionPct"] == 13, f"config not saved: {cfg['fees']}"
    # revert
    pct_input.fill("12")
    page.get_by_role("button", name="Guardar cambios").first.click()
    page.wait_for_timeout(1_200)
    cfg = page.evaluate("fetch('/api/config').then(r => r.json())")
    assert cfg["fees"]["commissionPct"] == 12, "config not reverted"
    shot("13-config-reverted")

    # ---------- theme toggle inside admin + logout ----------
    page.locator("[aria-label='Cambiar tema']").click()
    page.wait_for_timeout(500)
    assert "dark" in (page.locator("html").get_attribute("class") or "")
    shot("14-admin-dark")
    page.locator("[aria-label='Cambiar tema']").click()
    page.wait_for_timeout(500)

    logout(page)
    assert_no_errors(errors, "admin operations")
