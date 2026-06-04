"""
Creates Supabase auth accounts for all demo tenants and links them
to their tenant records via supabase_user_id.
Run once: python -m scripts.seed_tenant_users
"""
import asyncio
import os
import httpx
import asyncpg

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DATABASE_URL = os.environ["DATABASE_URL"]

TENANTS = [
    "sarah.johnson@example.com",
    "mike.torres@example.com",
    "amanda.chen@example.com",
    "david.park@example.com",
    "lisa.williams@example.com",
    "james.brown@example.com",
    "patricia.davis@example.com",
    "robert.wilson@example.com",
    "jennifer.martinez@example.com",
    "kevin.lee@example.com",
    "michelle.taylor@example.com",
    "thomas.anderson@example.com",
    "sandra.white@example.com",
    "christopher.harris@example.com",
    "rachel.thompson@example.com",
]


async def main():
    conn = await asyncpg.connect(DATABASE_URL, ssl="require", statement_cache_size=0)

    async with httpx.AsyncClient() as client:
        for email in TENANTS:
            # Create Supabase auth user
            resp = await client.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "email": email,
                    "password": "password123",
                    "email_confirm": True,
                    "app_metadata": {"role": "tenant"},
                },
            )

            if resp.status_code not in (200, 201):
                print(f"SKIP {email}: {resp.status_code} {resp.text}")
                continue

            user_id = resp.json()["id"]

            # Link to tenant record
            result = await conn.execute(
                "UPDATE tenants SET supabase_user_id = $1 WHERE email = $2",
                user_id,
                email,
            )
            print(f"OK {email} -> {user_id} ({result})")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
