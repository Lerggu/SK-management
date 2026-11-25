"""Renames the demo seed to a fictional steel mill site (journey runs only).

Run before seeding: python3 scripts/demo-steel-theme.py
It edits prisma/seed.ts in place and swaps the site plan image; never commit the result.
"""
import shutil

REPLACEMENTS = [
    ("Nordic Data Center Demo", "Nordic Steel Mill Demo"),
    ("NDC-001", "NSM-001"),
    ("Data Hall A – sähkötahti", "Sulatto – asennustahti"),
    ("DC1 – Data Hall A", "EAF – Sulattorakennus"),
    ("Data Hall B sähköasennukset", "Valssaamon sähköasennukset"),
    ("Data Hall A kaapeloinnit ja nostot", "Sulaton asennukset ja nostot"),
    ("Data Hall A", "Sulatto (EAF)"),
    ("`Sali A, vyöhyke ${i}`", "`Sulatto, linja ${i}`"),
    ('name: "Kaapelihyllyt", trade: "Sähköasentaja"', 'name: "Teräsrakenteet", trade: "Asentaja"'),
    ('name: "Kaapelinveto", trade: "Sähköasentaja"', 'name: "Laiteasennukset", trade: "Asentaja"'),
    ('name: "Kytkennät", trade', 'name: "Kaapelointi ja kytkennät", trade'),
    ("Kaapelirummut 4 kpl (AXMK 4×240)", "Uunin kuoriosat 4 kpl"),
    ("Kaapelirummut 4 kpl", "Uunin kuoriosat 4 kpl"),
    ('quantity: "4 rumpua"', 'quantity: "4 osaa"'),
    ("Kaapelihyllyt 200 m", "Nosturiradan palkit 24 kpl"),
    ('quantity: "200 m", date', 'quantity: "24 kpl", date'),
    ("Hylly Demo Oy", "Palkki Demo AB"),
    ("Kaapeli Demo Oy", "Teräs Demo AB"),
    ("Kaapelihyllynippujen nosto 2. kerrokseen", "Nosturiradan palkkien nosto +12 m tasolle"),
    ("Muuntajan nosto perustukselle", "Uunimuuntajan nosto perustukselle"),
    ("Kaapelivarasto", "Teräsrakennevarasto"),
    ("Kaapelikelojen välissä kulkuväylä tukossa", "Teräspalkkien välissä kulkuväylä tukossa"),
    ("Hyllynippu heilahti noston aikana", "Palkki heilahti noston aikana"),
    ("Nordic Hyperscale Demo Oy", "Nordic Steel Demo AB"),
    ('"Ajoneuvonosturi, 18 t muuntaja"', '"Ajoneuvonosturi, 18 t uunimuuntaja"'),
]

path = "prisma/seed.ts"
s = open(path, encoding="utf-8").read()
for a, b in REPLACEMENTS:
    s = s.replace(a, b)
open(path, "w", encoding="utf-8").write(s)
shutil.copyfile("prisma/seed-assets/steel-site-plan.png", "prisma/seed-assets/ndc-site-plan.png")
print("steel theme applied")
