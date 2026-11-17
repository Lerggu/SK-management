# ADR 0028 — Personal identity code (henkilötunnus)

- Status: Accepted (owner request, 2026-11-18).
- The owner asked for two things:
  - the employee number (the company's own identifier) clearly separated;
  - the Finnish personal identity code as its own field.

## Decision

### Employee number
- The field is labelled "Henkilönumero (yrityksen oma)". A hint says it is the company's identifier (e.g. the payroll number) and not the personal identity code.
- The personnel card shows it as its own row and in the header ("Henkilönro").

### Personal identity code
The personal identity code is the most sensitive personal identifier, so it is handled differently from every other field.
- **Storage:** encrypted at the application layer (AES-256-GCM, `src/platform/crypto/field.ts`).
  - Key: `SK_FIELD_KEY` (32 random bytes). In Azure it lives in Key Vault (`field-key`), which `infra/install.sh` creates once.
  - The database holds only the ciphertext (`personal_id_enc`) and a keyed HMAC (`personal_id_hash`). The HMAC makes the code unique within the company without storing it in clear.
  - Separate HKDF sub-keys are used for encryption and for the HMAC.
  - CHECK constraints keep the pair consistent and refuse anything but the `v1:` envelope, so a clear-text value cannot be written.
  - Outside production a fixed development key is used. In production without a key, codes can be neither stored nor shown, and the card says so.
- **Validation:** the official format DDMMYYCZZZQ, with:
  - the century sign (+, -, Y–U, A–F);
  - a real date;
  - an individual number of 002 or above;
  - the mod-31 check character.
- **Permission:** new `employee.pid.manage`, sensitive and company-wide, granted to the CEO and the HR administrator. The migration grants it to existing roles and audits the grant.
  - No other role sees whether a code exists.
- **Separate service:** `personalIdService` (status, reveal, set, clear).
  - The code is never part of employee lists, the personnel card data, exports, rotation, staffing or AI.
  - The card shows it masked (`••••••-•••T`).
  - "Näytä" fetches the full code on request. It is never rendered into the page markup.
- **Audit:**
  - `employee.pid_set`, `employee.pid_clear` and `employee.pid_view`; every reveal is logged;
  - audit deltas mask `personalIdEnc` and `personalIdHash`, and no event holds the value.

## Consequences
- **Losing the key makes stored codes unreadable.** Key Vault soft delete and purge protection protect it.
- **Key rotation is not automated.** A rotation would decrypt with the old key and re-encrypt with the new one in a one-off script.
- **Foreign workers without a Finnish code are not covered.** A foreign identifier would need its own field and rules.
