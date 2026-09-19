#!/bin/zsh
# Draait de PHP-versie lokaal, om te proberen wat er straks bij Vimexx staat:
# opslag op de server (map data/) in plaats van in de browser.
# Sluit het terminalvenster (of druk Ctrl-C) om te stoppen.
set -u
DIR="${0:A:h}"
PORT=4178

# Niet in een beschermde map (Bureaublad/Documenten) blijven staan.
cd "$HOME" 2>/dev/null || cd /

if ! /bin/ls "$DIR/index.html" >/dev/null 2>&1; then
  print -r -- "Terminal mag deze map niet lezen: $DIR"
  print -r -- "Kwam er een venster van macOS met de vraag om toegang? Klik OK en start opnieuw."
  read -r _
  exit 1
fi

PHP=$(command -v php)
if [[ -z "$PHP" ]]; then
  print -r -- "PHP niet gevonden. Installeren kan met:  brew install php"
  print -r -- "Of gebruik start.command; dat is de versie die de browser zelf laat opslaan."
  read -r _
  exit 1
fi

if grep -q "'wachtwoord' => ''" "$DIR/config.php" 2>/dev/null; then
  print -r -- "Let op: er staat nog geen wachtwoord in config.php."
  print -r -- "De server weigert dan alles. Zet er eerst een in."
  print -r -- ""
fi

# php -S kan geen https, en Safari weigert http://localhost ("Alleen HTTPS").
# Daarom openen we hier Chrome/Firefox; voor Safari is start.command bedoeld.
BROWSER=""
for app in "Google Chrome" "Firefox" "Microsoft Edge" "Brave Browser"; do
  [[ -d "/Applications/$app.app" ]] && { BROWSER="$app"; break }
done

( repeat 40 { /usr/bin/nc -z 127.0.0.1 $PORT >/dev/null 2>&1 && {
    if [[ -n "$BROWSER" ]]; then open -a "$BROWSER" "http://localhost:$PORT/"; else open "http://localhost:$PORT/"; fi
    break }; sleep 0.25 } ) &

print -r -- "Kwartetmaker (PHP-versie) op http://localhost:$PORT/"
print -r -- "Opslag: $DIR/data"
print -r -- "Alleen deze computer; Safari weigert http, gebruik daarvoor start.command."
print -r -- ""
exec "$PHP" -S 127.0.0.1:$PORT -t "$DIR"
