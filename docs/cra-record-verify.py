#!/usr/bin/env python3
"""
Independent verifier for `legalithm.cra.record/v0.2`.

    python3 cra-record-verify.py path/to/compliance/cra

Exit 0 if the record is intact and any signature over it is valid, 1 otherwise.

WHY THIS FILE EXISTS
--------------------
`docs/CRA-RECORD-FORMAT.md` promises the format is open and irrevocable. A
promise like that is only worth whether somebody else can actually implement it,
and the CLI's own `cra record --verify` cannot answer that: it shares a codebase
with the writer, so it would agree with a wrong specification just as happily as
a right one.

This is deliberately a different language, a different JSON library, a different
crypto library, and no shared code with the CLI. It was written from the
specification text alone and matched the real record's hash on the first run,
which is the evidence that the document is sufficient rather than merely present.

It is also the thing that catches a spec that has quietly drifted: the CLI and
the record can agree with each other while both disagree with what is written
down, and nothing in the TypeScript test suite can see that.

Requires `cryptography` for Ed25519. Everything else is stdlib. Rolling your own
signature verification here would defeat the purpose, which is to demonstrate
that an ordinary implementer with ordinary tools can check one of these.
"""

from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import sys

HASH_EXCLUDED = ("recordHash", "generatedAt", "asOf")


def record_hash(record: dict) -> str:
    """
    SHA-256 over the record with `recordHash`, `generatedAt` and `asOf` removed.

    The two timestamps are excluded because they are "the moment you ran it".
    Including either would make two runs over identical evidence hash
    differently, which breaks offline verification and makes any signature
    unreproducible. The hash covers content, not the clock.

    Canonical serialisation: keys sorted, no insignificant whitespace.
    """
    body = {k: v for k, v in record.items() if k not in HASH_EXCLUDED}
    payload = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2

    d = pathlib.Path(argv[1])
    record_path = d / "record.json"
    if not record_path.exists():
        print(f"No record at {record_path}", file=sys.stderr)
        return 1

    record = json.loads(record_path.read_text(encoding="utf-8"))

    schema = record.get("schema", "")
    if schema != "legalithm.cra.record/v0.2":
        # Not fatal. Say so rather than pretending to have checked a version
        # this file does not implement.
        print(f"! record declares {schema!r}; this verifier implements v0.2")

    stored = record.get("recordHash", "")
    computed = record_hash(record)
    intact = computed == stored

    print(f"  stored     {stored}")
    if not intact:
        print(f"  recomputed {computed}")
    print("  integrity: " + ("OK" if intact else "ALTERED since it was generated"))

    sig_path = d / "record.signature.json"
    if not sig_path.exists():
        print("  no detached signature: the hash shows the record is unaltered,")
        print("  it does not say who issued it.")
        return 0 if intact else 1

    sig = json.loads(sig_path.read_text(encoding="utf-8"))
    key_id = sig.get("keyId", "")

    keys_path = d / "verification-keys.json"
    if not keys_path.exists():
        print(f"  signature is under {key_id!r} and no public key is published.")
        print("  verification-keys.json is missing, so nobody can check this.")
        return 1

    pem = json.loads(keys_path.read_text(encoding="utf-8")).get("keys", {}).get(key_id)
    if pem is None:
        print(f"  no published key for {key_id!r}")
        return 1

    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
    except ImportError:
        print("  cannot check the signature: pip install cryptography")
        return 1

    public_key = load_pem_public_key(pem.encode("utf-8"))
    try:
        # The signature is over the recordHash STRING, not over the document.
        public_key.verify(base64.b64decode(sig["signature"]), stored.encode("utf-8"))
        genuine = True
    except InvalidSignature:
        genuine = False

    if not intact:
        # A signature over a hash the content no longer produces is not a valid
        # record. Never print "valid" on its own line here: somebody skimming for
        # that word would accept an altered document.
        if genuine:
            print(f"  signature: genuine (key {key_id!r}), but it covers the ORIGINAL")
            print("  record, not this one. Treat this record as untrusted.")
        else:
            print(f"  signature: INVALID (key {key_id!r})")
        return 1

    if not genuine:
        print(f"  signature: INVALID (key {key_id!r})")
        return 1

    print(f"  signature: valid (key {key_id!r}, {sig.get('algorithm')})")
    print("  This proves the record was signed by whoever holds that key.")
    print("  It does not prove who that is: confirm the key out of band.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
