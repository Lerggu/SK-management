# ADR 0031 — Voice and text assistant

- Status: Accepted (owner, 2026-11-18).
- The owner wants to enter almost anything by speaking in everyday Finnish, from the app now and later from WhatsApp. For example: "lisää henkilö Matti Meikäläinen, ajoneuvonosturin kuljettaja, ja lisää hänet työmaalle Lappeenranta 15.12. alkaen", or "aloitetaanpa uusi projekti Mikkeli". Money must be confirmed separately.
- Phase 1 is the assistant in the app. WhatsApp is phase 3 and needs its own decision (Meta Business account, number, costs).
- **Owner decisions (2026-11-18):**
  - the content of a spoken or typed request, names included, may be processed by the AI provider. This changes the V8 "no personal data" rule *for the assistant only*. Personal identity codes, rates and other sensitive fields are still never sent;
  - speech recognition uses Azure AI Speech in the company's Azure tenant.

## Decision

### Proposals, never direct writes
- **Flow:** the person speaks or types. Claude (`src/platform/ai`, with conversation history) understands the request, looks up existing things with read-only search tools (projects, sites, people, teams, task types), and answers with a short reply plus proposed actions.
- **Action catalogue (`modules/assistant/actions.ts`):**
  - create project (the code is generated, e.g. MIK-01) and site;
  - add employee (the number is generated, E-####);
  - rotation period;
  - team, and team members;
  - logistics task;
  - safety observation;
  - employee rate (money).
- **Validation on the server:** each proposal's parameters are checked with Zod. The card summary is written by the server from the parameters and the names found in the database, never by the model. Invented ids and unknown action types are dropped, and the reply says how many.
- **References:** an action can refer to an item created earlier in the same proposal as `#n`, e.g. the new person in a rotation. A referenced action must be confirmed first.
- **Confirming:** nothing is saved until the person confirms a card ("Vahvista", or "Vahvista kaikki" for non-money cards). The confirmed action runs through the normal domain service with the person's own `RequestContext`, so permissions, validation and the domain audit apply exactly as in the UI. `assistant.confirm` is audited as well.
- **A new turn replaces unconfirmed proposals.** They are marked rejected.
- **Money:** money actions are never confirmed in bulk. The person types the amount again, and it must match.
- **Unclear requests:** the prompt tells the model to resolve relative dates, to ask when a weekday and a date disagree (15.12.2026 is a Tuesday) or when a detail is missing (e.g. the end of a rotation), and never to invent ids.

### Access, cost and records
- **Access:** requires `ai.use`; external members have no assistant.
- **Conversations are personal:** another member, even in the same company, gets 404.
- **Cost:** each turn is an `ai_runs` row (kind `ASSISTANT`, no project) and counts towards the company's monthly cap. `ai_runs.project_id` became nullable.
- **Storage:** messages are kept in `assistant_conversations` (the last 40) and proposals in `assistant_actions`. Both have RLS and composite foreign keys.

### Speech
- **Recording:** the browser records WAV, 16 kHz mono (`ui/lib/wav-recorder.ts`), at most 55 seconds.
- **Upload:** the recording goes to `/c/{slug}/assistant/transcribe` (same origin only). The platform port `src/platform/speech` sends it to the Azure AI Speech short-audio REST API, in Finnish or English.
- **Configuration:** `SK_SPEECH_KEY` (Key Vault `speech-key`) and `SK_SPEECH_REGION`. Without them the microphone is hidden and typing works.

### User interface
- A microphone button on every page opens *Avustaja*.
- The page shows the chat, proposal cards with Confirm and Cancel, and the money amount field.

## Consequences
- **Free text is not stored in the run log.** The `ai_runs` question/kind rule stays, and the text lives only in the person's conversation.
- **Deterministic test provider:** understands only "uusi projekti X" and "henkilö Etunimi Sukunimi", for tests and keyless development.
- **Next steps:**
  - phase 2: guided whole-project set-up;
  - phase 3: WhatsApp, with phone numbers from the registration form identifying people.
