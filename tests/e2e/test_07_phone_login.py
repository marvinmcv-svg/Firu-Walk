"""Phone + login-code flow (demo mode: the code is config.demo.otpCode),
plus logout revoking the server session."""
import random

from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, logout


def test_phone_code_login_and_logout(page, errors):
    phone = f"7{random.randint(1000000, 9999999)}"  # fresh number → new owner account
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Ingresar").first.click()
    dlg = page.get_by_role("dialog")
    dlg.locator("#login-phone").fill(phone)
    dlg.get_by_role("button", name="Enviar código").click()
    expect(dlg).to_contain_text("Modo demo")
    dlg.locator("#login-code").fill("123456")
    dlg.get_by_role("button", name="Ingresar").click()

    expect(page.locator("[aria-label='Notificaciones']")).to_be_visible()
    status = page.evaluate("async () => (await fetch('/api/users/me')).status")
    assert status == 200

    logout(page)
    status = page.evaluate("async () => (await fetch('/api/users/me')).status")
    assert status == 401, "session must be revoked server-side on logout"
    assert_no_errors(errors, "phone login")
