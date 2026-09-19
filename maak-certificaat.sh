#!/bin/zsh
# Maakt een certificaat voor deze Mac, zodat de Kwartetmaker via https draait.
#
#   ~/.kwartetmaker/ca.pem         het certificaat dat je vertrouwt (ook op een
#                                  andere computer)
#   ~/.kwartetmaker/localhost.pem  sleutel + certificaat voor de server
#
# De server-certificaten worden automatisch vernieuwd als je IP-adres verandert
# of als ze verlopen. De CA blijft dan gelijk, dus vertrouwen hoeft maar één keer.
set -eu
DIR="$HOME/.kwartetmaker"
CA="$DIR/ca.pem"
CA_KEY="$DIR/ca-key.pem"
LEAF="$DIR/localhost.pem"
mkdir -p "$DIR"
chmod 700 "$DIR"

HOSTN=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
SAN="DNS:localhost,DNS:${HOSTN}.local,DNS:${HOSTN},IP:127.0.0.1"
for iface in en0 en1 en2; do
  ip=$(ipconfig getifaddr $iface 2>/dev/null) || true
  [[ -n "${ip:-}" ]] && SAN="$SAN,IP:$ip"
  unset ip
done

# Moet het servercertificaat opnieuw? (ontbreekt, verloopt binnen een week,
# of dekt de huidige namen/adressen niet meer)
need_leaf=1
if [[ -f "$LEAF" ]]; then
  # -ext kent LibreSSL (/usr/bin/openssl) niet, dus via -text uitlezen.
  current=$(openssl x509 -in "$LEAF" -noout -text 2>/dev/null \
            | grep -A1 "Subject Alternative Name" | tail -1 \
            | sed 's/IP Address:/IP:/g' | tr -d ' ')
  wanted=$(print -r -- "$SAN" | tr -d ' ')
  if [[ "$current" == "$wanted" ]] && openssl x509 -in "$LEAF" -noout -checkend 604800 >/dev/null 2>&1; then
    need_leaf=0
  fi
fi

if [[ ! -f "$CA" ]]; then
  cat > "$DIR/ca.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Kwartetmaker lokale CA ($HOSTN)
O = Kwartetmaker
[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
CNF
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
    -keyout "$CA_KEY" -out "$CA" -config "$DIR/ca.cnf" -extensions v3_ca >/dev/null 2>&1
  chmod 600 "$CA_KEY"
  need_leaf=1
  print -r -- "nieuwe-ca"
fi

if (( need_leaf )); then
  cat > "$DIR/leaf.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $HOSTN
[v3_leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SAN
CNF
  openssl req -new -newkey rsa:2048 -nodes -keyout "$DIR/leaf-key.pem" \
    -out "$DIR/leaf.csr" -config "$DIR/leaf.cnf" >/dev/null 2>&1
  openssl x509 -req -in "$DIR/leaf.csr" -CA "$CA" -CAkey "$CA_KEY" -CAcreateserial \
    -days 397 -sha256 -extfile "$DIR/leaf.cnf" -extensions v3_leaf \
    -out "$DIR/leaf.pem" >/dev/null 2>&1
  cat "$DIR/leaf-key.pem" "$DIR/leaf.pem" > "$LEAF"
  chmod 600 "$LEAF" "$DIR/leaf-key.pem"
  rm -f "$DIR/leaf.csr"
fi

print -r -- "$LEAF"
