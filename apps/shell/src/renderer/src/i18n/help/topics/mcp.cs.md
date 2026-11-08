# Připojení programového agenta

HermesOffice mluví protokolem Model Context Protocol, takže programový agent může číst, zapisovat a vykreslovat vaše dokumenty stejnými enginy, jaké používá aplikace. Agent netuší formát souboru: dostane typovaná schémata op ze stejných definic, proti kterým executor validuje.

## Registrace v aplikaci

Uděláte to v **Nastavení ▸ Integrace**. Panel má dvě poloviny a můžete použít jednu, druhou, nebo obě.

**Skill.** Jeden řádek na každého programového agenta nalezeného v tomto počítači — Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, OpenCode, Windsurf —, každý s **Nainstalovat**, **Aktualizovat** a **Odinstalovat**, navíc **Nainstalovat do jiné složky…**, **Stáhnout skill (zip)** a **Kopírovat cestu**. Pokud váš asistent v seznamu není, ukážte HermesOffice složku, ze které čte `SKILL.md`, nebo uložte zip a nechte ho nainstalovat samotný asistent. Skill a MCP mohou stát vedle sebe: asistent si vybere jedno z nich a dělají přesně stejné věci.

**MCP.** Nabízí se dvě cesta: **Spouští asistent (doporučeno)** — tam přidáte zobrazenou konfiguraci do svého klienta a asistent server spustí sám — a **Místní HTTP server**, který spustí aplikace za vás. Tak či onak nakonec asistent mluví s HermesOffice a vy nikdy nenapíšete příkaz.

**Vyzkoušejte** Otevřete v asistentovi nový chat a požádejte běžnými slovy, například:

- “Převeď ~/Downloads/report.md na dokument Word”
- “Udělej prezentaci o 6 snímcích o našich výsledcích za 3. čtvrtletí”
- “Převeď budget.xlsx do PDF a otevři ho v HermesOffice”

## Registrace z příkazového řádku

Totéž z terminálu — to je pokročilá cesta, po které sáhnete, když je agent tam, kde panel nemůže najít:

```sh
hermesoffice mcp install all
```

Najde programové agenty v tomto počítači a zapíše záznam stdio serveru do vlastní konfigurace každého z nich, zatímco zbytek souboru nechá být, jak ho našel.

```sh
hermesoffice mcp list             # where each agent stands
hermesoffice mcp install cursor    # just one
hermesoffice mcp uninstall cursor  # take it back out
```

Agent nainstalovaný na neobvyklém místě vyžaduje `--dir <path>`; `--force` přepíše záznam, který tam už je.

Všechno, co server přijímá, se vejde na jednu obrazovku — tvary pro registraci, odebrání a výpis, poskytování přes HTTP a dva přepínače schémat:

![Skutečný výstup hermesoffice mcp --help: tvary install, uninstall a list s volbami --http, --host, --token, --compact-schemas, --dir a --force](img/mcp.png)

## Spuštění vlastníma rukama

Pro klienta v jiném počítači jej místo toho vystavte přes HTTP:

```sh
hermesoffice mcp --http 8765 --token <secret>
```

`--host <addr>` mění, kde naslouchá. Klientovi předáte stejný token.

Přes HTTP putují i soubory: `PUT /files/<name>` nahraje jeden, každý nástroj bere místo cesty adresu `http(s)` a výstupy se vracejí jako adresy ke stažení — a pokud jsou dost malé, jako vložené zdroje. Op, spec a Markdown se v obou případech předávají přímo v těle.

## Co agent dostane

Každý příkaz je nástroj. Zajímavé jsou tyto:

- **`docs`, `sheet`, `slides`** — čtou a upravují soubor cestou zápisu aplikace, jednu **op** po druhé. Nová prezentace jde přes `deck_start`, `deck_page`, `deck_build`.
- **`render`** — jeden PNG na stránku, vykreslený vykreslovačem aplikace, takže agent se může na snímek podívat, místo aby ho hádal.
- **`pdf`** — textová vrstva PDF, stránka po stránce, bez procesu aplikace.
- **`info`** — metadata a souhrn struktury, obvykle nejlevnější první volání na neznámém souboru.
- **`search`, `image`, `media`** — poskytovatelé nastavení v aplikaci, takže agent nepotřebuje vlastní klíče.
- **`merge`** — vyplní šablonu `{{key}}`.

## Schémata a menší rozpočet

`apply` a `create` oznamují své parametry `ops`, `cells` a `data` s typovaným schématem pro každou op, vygenerovaným z `hermesoffice guide <domain> --json`. Je to přesné a ne malé. Klient s úzkým kontextovým oknem si může místo toho požádat o prostá pole:

```sh
hermesoffice mcp --compact-schemas
HERMESOFFICE_MCP_COMPACT_SCHEMAS=1 hermesoffice mcp
```

## Proč skill

Agent, který nezná slovní zásobu op, bude hádat. Skill přináší referenční příručku a návrhové průvodce — přesně ty materiály, které vypíše `hermesoffice guide` —, takže asistent píše ops, jejichž specifikaci si opravdu přečetl. Nainstalujte ho z panelu nahoře nebo příkazem `hermesoffice skill` z terminálu.

## Čeho se v aplikaci dostane

Server není omezen na soubory na disku. Dokud HermesOffice běží, může agent pracovat i přes okno:

- **`open_in_hermesoffice`** otevře soubor v kartě a dá jí fokus.
- **`open_documents`** vypíše každý dokument, který máte otevřený — id, typ, cestu a zda v něm jsou neuložené změny — a pak přečte aktuální obsah jednoho z nich, uloží ho na místě, nebo ho zavře, přičemž nejdřív uloží, pokud mu neřeknete, aby změny zahodil.
- **Nástroje pro obsah** berou to id (nebo cestu) jako svůj argument `document`, takže úprava dopadne do karty, kterou už otevřenou máte, a okno se na ni přepne.

Dvě věci zůstávají mimo dosah: není tu panel AI a dialog aktualizace v aplikaci zde neplatí. Pokud nějaký krok potřebuje okno, soubor otevřete.

## Panel místního HTTP serveru

Pod **Místní HTTP server** spouští aplikace server sama, místo aby ho nechala asistentovi: přepínač zapnutí, pole **Port**, ukazatel **Běží / Zastaveno** a **Generování na pozadí** (zapisovat dokumenty rovnou do cesty bez otevírání rozhraní) a **Ukázková konfigurace klienta** ke zkopírování. Rozbalení **Pokročilé** přidá obě připojovací adresy — Streamable HTTP a starší adresu SSE —, adresu pro **Kontrolu stavu** a přepínač **Protokolování**, který zaznamenává činnost serveru a nástrojů do místního souboru, který můžete odtud **Otevřít**, **Obnovit** nebo **Vymazat**. Naslouchá pouze na localhost.
