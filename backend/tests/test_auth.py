"""Guards for the two access-control rules that have to hold everywhere.

1. Role and hoa_id come only from app_metadata. user_metadata is writable by
   the user with the public anon key, so trusting it lets anyone sign up as
   super_user.
2. HOA-scoped admin endpoints go through _assert_hoa_access (which routes PMs
   through the firm predicate). The old inline `if user.hoa_id and ...` check
   let every property_manager, from any firm, through, because PMs have no
   hoa_id.
"""
import asyncio
import pathlib
import re

import pytest
from fastapi import HTTPException

import auth.jwt as jwt_mod
from auth.jwt import AuthUser, get_current_user


class _Creds:
    credentials = "token"


def _user_for(payload, monkeypatch):
    monkeypatch.setattr(jwt_mod, "decode_token", lambda _t: payload)
    return asyncio.run(get_current_user(_Creds()))


def test_user_metadata_role_is_ignored(monkeypatch):
    u = _user_for({"sub": "x", "user_metadata": {"role": "super_user",
                                                  "hoa_id": "h1"}}, monkeypatch)
    assert u.role == "tenant"
    assert u.hoa_id is None


def test_app_metadata_role_is_used(monkeypatch):
    u = _user_for({"sub": "x", "app_metadata": {"role": "hoa_admin", "hoa_id": "h1"},
                   "user_metadata": {"role": "super_user"}}, monkeypatch)
    assert u.role == "hoa_admin"
    assert u.hoa_id == "h1"


def test_hoa_admin_without_hoa_id_fails_closed():
    from routes.hoa import _assert_hoa_access
    user = AuthUser(sub="x", email="", role="hoa_admin", hoa_id=None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(_assert_hoa_access(user, "00000000-0000-0000-0000-000000000001", None))
    assert e.value.status_code == 403


def test_no_inline_hoa_id_checks_in_routes():
    routes = pathlib.Path(__file__).resolve().parent.parent / "routes"
    pat = re.compile(r"if user\.hoa_id and str\(")
    offenders = [f"{p.name}:{i}" for p in routes.glob("*.py")
                 for i, line in enumerate(p.read_text().splitlines(), 1)
                 if pat.search(line)]
    assert not offenders, f"use _assert_hoa_access instead: {offenders}"
