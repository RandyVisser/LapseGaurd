"""
One-time script to import units from a CSV exported from PropertyRadar
into a given (new/empty) HOA.

Usage:
    cd backend
    python scripts/import_units_csv_new_hoa.py <hoa_id> /path/to/file.csv
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

DEFAULT_STATE = 'FL'


def parse_address(raw: str):
    raw = (raw or '').strip()
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


async def main(hoa_id: str, csv_path: str):
    db_url = os.environ['DATABASE_URL']
    conn = await asyncpg.connect(db_url, statement_cache_size=0)

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Importing {len(rows)} rows into HOA {hoa_id}…")

    inserted = 0
    def v(row, key):
        return (row.get(key) or '').strip() or None

    for row in rows:
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
            hoa_id,
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
    if len(sys.argv) < 3:
        print("Usage: python scripts/import_units_csv_new_hoa.py <hoa_id> <path_to_csv>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
