#!/bin/zsh
# Dubbelklik dit bestand om de Kwartetmaker te starten.
# Sluit het terminalvenster (of druk Ctrl-C) om te stoppen.
set -u
DIR="${0:A:h}"
PORT=4177

# Instellingen -----------------------------------------------------------
BROWSER=""   # leeg = je standaardbrowser. Of bijv. BROWSER="Safari"
LAN=1        # 1 = ook bereikbaar voor andere computers in je netwerk, 0 = alleen deze Mac
# ------------------------------------------------------------------------

# Niet in een door macOS beschermde map (Bureaublad/Documenten) blijven staan:
# python3 struikelt daar over os.getcwd() met "Operation not permitted".
cd "$HOME" 2>/dev/null || cd /

# Dit leesje lokt zo nodig de macOS-vraag om toegang uit.
if ! /bin/ls "$DIR/index.html" >/dev/null 2>&1; then
  print -r -- ""
  print -r -- "Terminal mag deze map niet lezen:"
  print -r -- "  $DIR"
  print -r -- ""
  print -r -- "Kwam er net een venster van macOS met de vraag om toegang? Klik OK en"
  print -r -- "start dit bestand opnieuw. Zo niet, geef Terminal toegang via:"
  print -r -- "  Systeeminstellingen > Privacy en beveiliging > Bestanden en mappen"
  print -r -- "(of verplaats de map naar een niet-beschermde plek, zoals /Applications)."
  print -r -- ""
  print -r -- "Druk op Enter om te sluiten."
  read -r _
  exit 1
fi

PY=$(command -v python3 || command -v python)
if [[ -z "$PY" ]]; then
  print -r -- "Python 3 niet gevonden. Installeer het met:  xcode-select --install"
  read -r _
  exit 1
fi

# Certificaat: https is nodig omdat Safari http:// weigert ("Alleen HTTPS").
CERT=""
if command -v openssl >/dev/null 2>&1 && [[ -x "$DIR/maak-certificaat.sh" ]]; then
  if certout=$("$DIR/maak-certificaat.sh" 2>/dev/null); then
    CERT=$(print -r -- "$certout" | tail -1)
    # Nog niet vertrouwd? Dan waarschuwt de browser elke keer. Eenmalig aanbieden.
    CA="$HOME/.kwartetmaker/ca.pem"
    NIET_VRAGEN="$HOME/.kwartetmaker/niet-vragen"
    if [[ -f "$CA" ]] && ! security verify-cert -c "$CA" >/dev/null 2>&1 && [[ ! -f "$NIET_VRAGEN" ]]; then
      print -r -- ""
      print -r -- "Het certificaat van deze Mac is nog niet vertrouwd; de browser"
      print -r -- "waarschuwt dan bij elk bezoek. In je sleutelhanger zetten?"
      print -r -- "macOS vraagt daarbij om je wachtwoord."
      print -rn -- "Vertrouwen? [j/N] "
      read -r antwoord
      if [[ "$antwoord" == (j|J|y|Y) ]]; then
        if security add-trusted-cert -r trustRoot \
             -k "$HOME/Library/Keychains/login.keychain-db" "$CA"; then
          print -r -- "Gelukt."
        else
          print -r -- "Niet gelukt - je kunt in de browser ook doorklikken."
        fi
      else
        : > "$NIET_VRAGEN"
        print -r -- "Goed, ik vraag het niet meer. Later alsnog:"
        print -r -- "  security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.kwartetmaker/ca.pem"
      fi
      print -r -- ""
    fi
  fi
fi
SCHEME="http"; [[ -n "$CERT" ]] && SCHEME="https"
URL="$SCHEME://localhost:$PORT/"

open_app() {
  if [[ -n "$BROWSER" ]] && open -a "$BROWSER" "$URL" 2>/dev/null; then
    return
  fi
  open "$URL"
}

# Draait er al een server op deze poort? Dan alleen de browser openen.
if /usr/bin/nc -z 127.0.0.1 $PORT >/dev/null 2>&1; then
  print -r -- "Er draait al iets op poort $PORT - browser wordt geopend."
  open_app
  exit 0
fi

# Browser openen zodra de server luistert.
( repeat 40 { /usr/bin/nc -z 127.0.0.1 $PORT >/dev/null 2>&1 && { open_app; break }; sleep 0.25 } ) &

args=( "$DIR" --port $PORT )
[[ -n "$CERT" ]] && args+=( --cert "$CERT" )
(( LAN )) && args+=( --lan )
exec "$PY" "$DIR/serve.py" "${args[@]}"
