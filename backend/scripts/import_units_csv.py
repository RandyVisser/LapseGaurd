"""
One-time script to clear existing units for the test HOA and import
units from a CSV exported from the county assessor.

Usage:
    cd backend
    python scripts/import_units_csv.py /path/to/file.csv
"""

import asyncio
import csv
import re
import sys
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

import asyncpg
from datetime import date

HOA_ID = '00000000-0000-0000-0000-000000000001'
DEFAULT_STATE = 'FL'


def parse_address(raw: str):
    """Split '9 ISLAND AVE APT 501' or '9 ISLAND AVE PH 1' into (street, unit)."""
    raw = (raw or '').strip()
    # Match APT, UNIT, STE, PH followed by identifier
    match = re.search(r'\b(APT|UNIT|STE|PH)\s*(\S+)', raw, re.IGNORECASE)
    if match:
        prefix = match.group(1).upper()
        identifier = match.group(2)
        unit = f'{prefix}{identifier}' if prefix == 'PH' else identifier
        street = raw[:match.start()].strip().rstrip(',')
    else:
        unit = ''
        street = raw
    return street, unit


async def main(csv_path: str):
    db_url = os.environ['DATABASE_URL']
    conn = await asyncpg.connect(db_url, statement_cache_size=0)

    # Clear existing units (cascades to tenants, policies, invites)
    deleted = await conn.execute("DELETE FROM units WHERE hoa_id = $1", HOA_ID)
    print(f"Cleared existing units: {deleted}")

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Importing {len(rows)} rows…")

    inserted = 0
    def v(row, key):
        """Return stripped string or None."""
        return (row.get(key) or '').strip() or None

    for row in rows:
        # Skip rows with no valid Radar ID (e.g. footer/disclaimer rows)
        radar = (row.get('Radar ID') or '').strip()
        if not radar or not re.match(r'^P[A-Z0-9]+$', radar):
            continue
        street, unit_number = parse_address(row.get('Address') or '')
        pd_str = (row.get('Purchase Date') or '').strip()
        purchase_date = date.fromisoformat(pd_str) if pd_str else None

        await conn.execute(
            """
            INSERT INTO units (
                hoa_id, unit_number, street_address, city, state, zip,
                radar_id, assessor_parcel_number, type, subdivision,
                owner_primary, email_primary,
                owner_secondary, email_secondary,
                purchase_date
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10,
                $11, $12,
                $13, $14,
                $15
            )
            """,
            HOA_ID,
            unit_number or v(row, 'Address'),
            street or None,
            v(row, 'City'),
            DEFAULT_STATE,
            v(row, 'ZIP'),
            v(row, 'Radar ID'),
            v(row, 'APN'),
            v(row, 'Type'),
            v(row, 'Subdivision'),
            v(row, 'Primary Name'),
            v(row, 'Primary Email1'),
            v(row, 'Secondary Name'),
            v(row, 'Secondary Email1'),
            purchase_date,
        )
        inserted += 1

    await conn.close()
    print(f"Done — {inserted} units imported.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/import_units_csv.py <path_to_csv>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
