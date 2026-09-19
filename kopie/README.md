# Kwartetmaker

Webapp om zelf een kwartetspel samen te stellen: 15 kwartetten (aan te passen),
elk met een thema, vier titels en vier foto's.

## Starten

Dubbelklik `start.command` in de Finder. Er opent een terminalvenster met een
kleine lokale webserver en de app opent vanzelf op https://localhost:4177/.
Terminalvenster sluiten = server stoppen.

De eerste keer maakt het script een certificaat voor deze Mac en vraagt of het
dat in je sleutelhanger mag zetten. Antwoord je `j`, dan vraagt macOS om je
wachtwoord en is daarna elke browser tevreden. Sla je het over, dan werkt het
ook, maar waarschuwt de browser bij elk bezoek ("verbinding is niet privé" →
doorklikken). Later alsnog vertrouwen:

```bash
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.kwartetmaker/ca.pem
```

Waarom https: Safari 26 weigert `http://localhost` met *'Alleen HTTPS' is
ingeschakeld*. Met een eigen certificaat is dat probleem weg en werkt elke
browser.

Handmatig starten kan ook:

```bash
python3 ~/Applications/kwartetmaker/serve.py ~/Applications/kwartetmaker --cert ~/.kwartetmaker/localhost.pem --lan
```

De app moet via de server draaien (niet door `index.html` te dubbelklikken),
anders werkt de opslag in de browser niet.

Let op: zet de map niet op je Bureaublad of in Documenten. Dat zijn door macOS
beschermde mappen; Terminal krijgt daar geen toegang en python stopt dan met
`Operation not permitted`. `/Applications` of je thuismap werkt prima.

## Op een andere computer

De server is ook bereikbaar voor andere computers in hetzelfde netwerk. Bij het
starten drukt hij de adressen af, bijvoorbeeld:

```
andere computer: https://Hanss-MacBook-Air.local:4177/
andere computer: https://10.0.1.34:4177/
```

Gebruik bij voorkeur het `.local`-adres; dat blijft gelijk, ook als je
IP-adres verandert. Safari op die computer waarschuwt over het certificaat.
Twee opties:

1. Doorklikken via "Toon details" → "deze website bezoeken".
2. Eenmalig vertrouwen: kopieer `~/.kwartetmaker/ca.pem` naar die computer
   (AirDrop), dubbelklik het bestand, zoek in Sleutelhangertoegang naar
   "Kwartetmaker" en zet Vertrouwen op "Vertrouw altijd".

**Belangrijk:** het spel zelf staat in de browser van de computer waarop je
werkt, niet op de server. Op die tweede computer begin je dus met een leeg
spel. Wil je daar verder met hetzelfde spel, gebruik dan *Back-up maken* op de
ene computer en *Terugzetten* op de andere (zie hieronder).

Wil je de server juist niet op het netwerk, zet dan bovenin `start.command`
`LAN=0`.

## Op een webhost zetten (Vimexx)

Dezelfde bestanden draaien ook op gewone webhosting met PHP. Dan staat het spel
op de server in plaats van in de browser, en werk je vanaf elke computer aan
hetzelfde spel - ook met Safari, en zonder certificaatgedoe.

Alles komt dan van de webhost: de pagina zelf én de opslag. Je hebt
`start.command`, `serve.py` en het certificaat niet meer nodig, en Safari doet
gewoon mee omdat Vimexx al https levert.

1. Zet een wachtwoord in `config.php`:

   ```php
   'wachtwoord' => 'iets-wat-niemand-raadt',
   ```

   Zolang dat leeg is, weigert de server alles. Een kwartet met je eigen foto's
   hoort niet open en bloot online te staan.
2. Zet met FTP (of het bestandsbeheer van Vimexx) deze bestanden in de webmap,
   bijvoorbeeld `public_html/kwartet/`:

   ```
   index.html  bekijk.html  api.php  config.php  .htaccess  css/  js/
   ```

   `start.command`, `serve.py` en `maak-certificaat.sh` zijn alleen voor de
   lokale versie; die kun je weglaten. Neem je ze toch mee, dan blokkeert de
   meegeleverde `.htaccess` ze.
3. Zorg dat de webserver in die map mag schrijven (de map `data` wordt vanzelf
   aangemaakt, rechten 755 is meestal genoeg).
4. Open `https://jouwdomein.nl/kwartet/`. Je krijgt een inlogscherm; daarna
   werkt alles zoals lokaal.

De app kijkt zelf of er een `api.php` naast staat. Is die er, dan bewaart hij
alles op de server (`data/spel.json` en `data/fotos/*.jpg`); zo niet, dan in de
browser. Je hoeft dus niets om te zetten - en met *Back-up maken* en
*Terugzetten…* verhuis je een spel van de ene naar de andere plek.

### Met meer computers tegelijk

Werken er meer mensen of computers tegelijk aan het spel, dan zie je elkaars
wijzigingen binnen een paar seconden verschijnen. De app kijkt elke vier
seconden of er iets nieuws is (niet als het tabblad op de achtergrond staat;
dan meteen als je terugkomt).

Er gaat niets verloren als je tegelijk werkt: de server houdt een
versienummer bij, en was iemand je voor, dan voegt de app beide wijzigingen per
veld samen voordat hij opslaat. Pas je allebei precies hetzelfde veld aan
(dezelfde titel, hetzelfde thema), dan wint wie het laatst opslaat. Ben je aan
het typen terwijl er iets binnenkomt, dan blijft je cursor gewoon staan.

Een nieuwe versie van de app zelf (na een upload) krijgt iedereen bij de
volgende keer herladen; de `.htaccess` zorgt dat browsers geen oude versie uit
hun cache gebruiken.

### Bekijk-link delen

*Delen…* bovenin (alleen in de gehoste versie) maakt een link waarmee iemand het
hele kwartet kan bekijken, ook op een telefoon, zonder wachtwoord. Die pagina
(`bekijk.html`) heeft geen bewerk-, download- of printknoppen; tik op een kaartje
om hem groot te zien. Wijzigingen verschijnen er binnen een paar seconden.

De link bevat een lange geheime code. De server staat met die code alleen
lezen toe: opslaan, foto's wijzigen en links beheren blijven achter je
wachtwoord. Met *Nieuwe link* maak je een andere code (de oude werkt dan niet
meer), met *Link uitzetten* sluit je hem helemaal. Bedenk wel: wie iets kan
bekijken, kan er ook een schermafbeelding van maken.

### Waar komt de datamap?

Standaard maakt `api.php` een map `data` naast zichzelf, afgeschermd met een
`.htaccess`. Dat werkt, maar veiliger is een map *buiten* de webmap: dan kan er
sowieso niemand rechtstreeks bij, ook niet als die `.htaccess` ooit wegvalt.

Bij Vimexx (DirectAdmin) ziet dat er zo uit:

```
/home/GEBRUIKER/domains/JOUWDOMEIN.nl/public_html/kwartet/   <- de app
/home/GEBRUIKER/domains/JOUWDOMEIN.nl/kwartet-data/          <- de datamap
```

In `config.php` zet je dan:

```php
'datamap' => __DIR__ . '/../../kwartet-data',
```

Staat de app direct in `public_html`, haal er dan één `/..` af. Blijf binnen de
map van je domein - hoger mag PHP meestal niet komen (`open_basedir`). Weet je
het pad niet zeker, zet dan tijdelijk een `pad.php` naast `api.php` met
`<?php echo __DIR__;`, open die in je browser en gooi hem daarna weg.

De map hoef je niet zelf te maken; dat doet `api.php` bij de eerste keer
opslaan. Krijg je "Opslaan mislukt", dan mag de webserver er niet in schrijven:
maak de map dan zelf aan via het bestandsbeheer met rechten 755.

Let op bij de lokale versie: `serve.py` weigert `.php`-bestanden en de map
`data`, want die server kan geen php draaien en zou de inhoud - inclusief je
wachtwoord - anders als tekst uitserveren.

## Gebruik

- **Foto's**: sleep ze rechtstreeks uit Apple Photos (of de Finder) op een
  kaartje. Sleep je er meerdere tegelijk op, dan worden de volgende kaartjes
  van dat kwartet automatisch gevuld. Klikken op een leeg kaartje of plakken
  (⌘V) werkt ook.
- **Uitsnede**: sleep in het kaartje om de foto te verschuiven, scroll om in te
  zoomen. Wijs je een kaartje aan, dan verschijnt er bovenop een balkje met 🖼
  (andere foto), een zoomschuif en ✕ (foto weg).
- **Naast Photos**: de app is gemaakt om in split screen naast Apple Photos te
  werken (bijv. een halve iMac 21,5"). De vier kaartjes staan in een 2×2 en
  schalen mee met de hoogte van het venster, zodat ze altijd alle vier in beeld
  zijn. De zijbalk is smal; houd je muis er even op, dan klapt hij uit tot de
  namen helemaal leesbaar zijn.
- **Thema en titels** typ je één keer; de vier titels verschijnen op alle vier
  de kaartjes van het kwartet, met de eigen titel in de themakleur.
- **Kleur**: elk kwartet krijgt automatisch een eigen kleur uit een palet van
  zestien tinten die op een rij goed uit elkaar te houden zijn en op wit
  leesbaar blijven. Zelf een kleur kiezen kan met de kleurkiezer; met
  *automatisch* pak je weer een tint die nog niet in gebruik is.

Safari leest HEIC-foto's, Chrome niet. Sleep je een HEIC uit Apple Photos naar
Chrome, dan meldt de app dat; exporteer hem dan als JPEG (in Photos: Archief >
Exporteer > Exporteer 1 foto, formaat JPEG).

## Back-up en overzetten

Onderin de zijbalk:

- *Back-up maken* → één zipbestand met `spel.json` (thema's, titels, uitsnedes,
  kleur) en alle foto's in `fotos/`. Zet dat bestand ergens neer waar je het
  terugvindt; het is de enige kopie buiten de browser.
- *Terugzetten…* → kies zo'n zipbestand. Het vervangt het spel dat op dat
  moment in die browser staat (er komt eerst een bevestiging).

Zo verhuis je een spel ook naar de andere computer, naar een andere browser, of
terug na het wissen van je websitegegevens.

## Printvellen

*Printvellen…* in de balk bovenin maakt één PDF met alle kaartjes:

- 9 kaartjes per A4 op ware grootte (63 × 88 mm), met snijlijnen in de marge.
- De achterkant ontwerp je in hetzelfde venster: tekst, kleur en motief, of
  sleep er een eigen foto op (slepen in het kaartje verschuift de uitsnede,
  de schuif zoomt in). Die achterkant is voor alle kaartjes gelijk - anders zie
  je van achteren al welk kwartet het is. De afbeelding loopt door tot de
  snijlijn, dus een scheve snee valt niet op.
- Met *achterkanten meeprinten* komt na elk vel met voorkanten een vel met
  achterkanten. Print dubbelzijdig met **omslaan over de lange kant**; de
  achterkanten staan daarvoor per rij in gespiegelde volgorde.

Zet in het printvenster "ware grootte" of 100 % aan, niet "passend maken",
anders kloppen de maten niet meer.

## Export

- *Exporteer dit kwartet* → zipbestand met één mapje, bijv.
  `01 Actief/` met `1 Abseilen.png` … `4 Paragliden.png`.
- *Exporteer alles* → één zipbestand met een mapje per kwartet.

Kaartjes worden geëxporteerd als PNG van 744 × 1039 px: 63 × 88 mm op 300 dpi,
het formaat van een standaard speelkaart.

Pak het zipbestand uit met dubbelklikken in de Finder (macOS zet accenten in
mapnamen dan goed neer; het `unzip`-commando in de Terminal kan daarover
struikelen).

## Opslag

Alles wordt automatisch bewaard in de browser (IndexedDB), inclusief de foto's,
en staat er de volgende keer weer. Twee dingen om te weten:

- De opslag hoort bij het adres waarop je werkt. `https://localhost:4177` en
  `https://Hanss-MacBook-Air.local:4177` zijn voor de browser twee
  verschillende plekken, elk met een eigen spel. Kies er dus één en blijf die
  gebruiken.
- Wis je de websitegegevens van die site, dan is het spel weg. *Nieuw spel…*
  wist alles bewust. Maak dus af en toe een back-up.

Foto's worden bij het plaatsen verkleind naar maximaal 1800 px en opgeslagen
als JPEG, ruim genoeg voor printkwaliteit.

## Bestanden

| Bestand | Wat het doet |
| --- | --- |
| `start.command` | dubbelklikken om te starten |
| `serve.py` | de lokale webserver (http of https) |
| `maak-certificaat.sh` | maakt en vernieuwt het certificaat in `~/.kwartetmaker` |
| `index.html` | schermopbouw |
| `css/style.css` | vormgeving van de app |
| `js/app.js` | bediening: kwartetten, foto's, export |
| `js/render.js` | tekent een kaartje (zelfde code voor preview en export) |
| `js/store.js` | kiest tussen opslag in de browser of op de server |
| `js/store-local.js` | opslag in de browser (IndexedDB) |
| `js/store-server.js` | opslag via `api.php` |
| `js/sync.js` | voegt wijzigingen van verschillende computers samen |
| `bekijk.html`, `js/bekijk.js`, `css/bekijk.css` | de bekijkpagina achter de deel-link |
| `api.php` | de server-opslag voor de gehoste versie |
| `.htaccess` | afscherming op de webhost |
| `config.php` | wachtwoord en datamap voor de gehoste versie |
| `js/zip.js` | maakt en leest zipbestanden (export en back-up) |
| `js/pdf.js` | zet de printvellen in een PDF |
| `js/colors.js` | het kleurenpalet voor de thema's |
