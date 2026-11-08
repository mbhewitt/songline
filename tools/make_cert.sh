#!/usr/bin/env bash
# Make a private certificate authority (CA) and an HTTPS certificate for the
# Songline server, so phones and tablets can use the microphone (browsers only
# allow the mic on https pages).
#
# usage: tools/make_cert.sh NAME_OR_IP [NAME_OR_IP ...]
#   e.g. tools/make_cert.sh 192.168.1.20 mycomputer.local
# Writes certs/{ca.crt,ca.key,server.crt,server.key}. Re-running reuses the CA,
# so a device that trusts ca.crt keeps working when you add an address.
#
# Install certs/ca.crt on each device as a trusted CA certificate (see README).
# Keep certs/ca.key private: anyone with it can make certificates your devices trust.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 NAME_OR_IP [NAME_OR_IP ...]" >&2; exit 2; }
command -v openssl >/dev/null || { echo "error: openssl not found; install it first" >&2; exit 1; }

D="${SONGLINE_CERT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/certs}"
mkdir -p "$D"; cd "$D"
umask 077

SAN=""
for h in "$@"; do
  if [[ $h =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || $h == *:* ]]; then SAN+="IP:$h,"; else SAN+="DNS:$h,"; fi
done
SAN=${SAN%,}

if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
    -subj "/CN=Songline private CA ($(hostname))" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
fi
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$1"
cat > ext.cnf <<X
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
X
# 397 days: the longest lifetime phones accept for a server certificate
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 397 -extfile ext.cnf
rm -f server.csr ext.cnf
chmod 644 ca.crt server.crt
openssl verify -CAfile ca.crt server.crt
echo "Done: $D (certificate for $SAN)"
