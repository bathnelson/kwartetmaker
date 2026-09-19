#!/bin/zsh
# Zet de serverbestanden op je webhost via FTPS. Alleen nodig bij de eerste
# keer, of als api.php verandert (de app zegt het dan vanzelf).
#
# Het wachtwoord staat NIET in dit bestand maar in je sleutelhanger. Zet het er
# één keer in (je typt het zelf, het komt nergens anders terecht):
#
#   security add-generic-password -s kwartetmaker-ftp -a JOUW-FTP-GEBRUIKER -w
#
set -u
DIR="${0:A:h}"

# ---- invullen ----------------------------------------------------------
HOST="ftp.jouwdomein.nl"
GEBRUIKER="jouw-ftp-gebruiker"
MAP="domains/jouwdomein.nl/public_html/kwartet"   # pad vanaf je ftp-thuismap
# ------------------------------------------------------------------------

cd "$HOME" 2>/dev/null || cd /

if [[ "$HOST" == ftp.jouwdomein.nl ]]; then
  print -r -- "Vul eerst bovenin dit bestand HOST, GEBRUIKER en MAP in."
  read -r _
  exit 1
fi

WACHTWOORD=$(security find-generic-password -s kwartetmaker-ftp -a "$GEBRUIKER" -w 2>/dev/null) || WACHTWOORD=""
if [[ -z "$WACHTWOORD" ]]; then
  print -r -- "Geen wachtwoord in de sleutelhanger gevonden. Zet het er eerst in met:"
  print -r -- ""
  print -r -- "  security add-generic-password -s kwartetmaker-ftp -a \"$GEBRUIKER\" -w"
  print -r -- ""
  print -r -- "Je typt het wachtwoord dan zelf; het komt niet in een bestand te staan."
  read -r _
  exit 1
fi

# Wat gaat er mee: de inhoud van vimexx/ - alles wat op de server zelf moet
# staan. De app (css, js) komt van GitHub, die hoef je hier nooit te uploaden.
#
# config.php bewust niet: daarin staan jouw wachtwoord en serverinstellingen.
# Start met ./upload.command --config om hem toch één keer mee te sturen.
PAREN=()
for f in index.html bekijk.html laden.js api.php .htaccess; do
  PAREN+=("vimexx/$f:$f")
done
[[ "${1:-}" == --config ]] && PAREN+=("vimexx/config.php:config.php")

print -r -- "Naar: ftps://$HOST/$MAP/  (gebruiker $GEBRUIKER)"
print -r -- "Bestanden:"
for p in $PAREN; do print -r -- "  ${p%%:*}  ->  ${p##*:}"; done
print -r -- ""
print -rn -- "Uploaden? [j/N] "
read -r antwoord
[[ "$antwoord" == (j|J|y|Y) ]] || { print -r -- "Afgebroken."; exit 0 }

fouten=0
for p in $PAREN; do
  lokaal="${p%%:*}"; op_server="${p##*:}"
  printf "%-22s " "$op_server"
  if curl --ssl-reqd --ftp-create-dirs --fail --silent --show-error \
       --user "$GEBRUIKER:$WACHTWOORD" \
       -T "$DIR/$lokaal" "ftp://$HOST/$MAP/$op_server"; then
    print -r -- "ok"
  else
    print -r -- "MISLUKT"
    ((fouten++))
  fi
done

print -r -- ""
if (( fouten )); then
  print -r -- "$fouten bestand(en) mislukt. Werkt FTPS niet bij je host, vervang dan"
  print -r -- "--ssl-reqd door --ftp-ssl (proberen) - of gebruik het bestandsbeheer van Vimexx."
else
  print -r -- "Klaar. Vergeet config.php niet één keer handmatig neer te zetten."
fi
print -r -- "Druk op Enter om te sluiten."
read -r _
