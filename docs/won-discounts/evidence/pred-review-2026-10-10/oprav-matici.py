#!/usr/bin/env python3
"""Marks findings as repaired in ../../matice-pred-review.md and regenerates Tabulka A.
   python3 oprav-matici.py 1,6,9   (every finding repaired so far)"""
import re, subprocess, sys, pathlib
here = pathlib.Path(__file__).parent
path = here / "../../matice-pred-review.md"
fixed = [n for n in sys.argv[1].split(",") if n]
s = path.read_text(encoding="utf-8")
table = subprocess.run(["node", str(here / "tabulka-a.mjs"), ",".join(fixed)], capture_output=True, text=True, check=True).stdout.strip()
s = re.sub(r"\| Obrazovka nebo pohled \|.*?(?=\n\n## Tabulka B)", lambda _: table, s, flags=re.S)
for n in fixed:
    s = re.sub(rf"^(\| {n} \|.*\| )otevřený( \|)$", r"\1opravený\2", s, flags=re.M)
path.write_text(s, encoding="utf-8")
print("otevřených B:", len(re.findall(r"^\| \d+ \|.*\| otevřený \|$", s, flags=re.M)), "| neplatí v tabulce A:", table.count("neplatí"))
