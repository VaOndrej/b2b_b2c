# 03: Lint: barvy jen v shellu (varování)

**What to build:** Když někdo napíše hex barvu nebo rgba do obrazovky nebo části mimo shell a tokeny, lint ho upozorní. Zatím jako varování, aby šlo přecházet postupně (chybou se stane v ticketu 25). Audit D1.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] npm run lint hlásí varování pro hex/rgba literál v komponentách mimo shell
- [ ] Shell a tokeny varování nehlásí
- [ ] Počet varování je zapsaný v ticketu jako výchozí stav (audit naměřil 121 hex mimo tokens)
