# Contact Recon V1 output notes

Canonical schema: `contracts/contact-recon-v1.schema.json` in the CRM project.

Allowed role categories:

`procurement`, `supply_chain`, `technical`, `engineering`, `production`, `commercial`, `executive`, `unknown`.

Allowed employment states:

`verified_current`, `likely_current`, `historical`, `left_company`, `unverified`, `conflicting`.

Allowed discovery types:

`public_direct`, `document_extracted`, `social_profile`, `email_pattern`, `pattern_inferred`, `switchboard`, `company_generic`, `manual`.

Never place a generic mailbox in a person's methods unless a public source explicitly identifies it as that person's address. Generic entries belong in `company_entry_points`.
