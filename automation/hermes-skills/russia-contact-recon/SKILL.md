---
name: russia-contact-recon
version: 1.0
description: |
  Contact-first public OSINT for Russian B2B leads. Find named procurement, supply-chain,
  technical, production, commercial, or executive contacts; verify current employment,
  decision relevance, and direct business contact methods with source evidence.
---

# Russia Contact Recon

The deliverable is a verified person/contact record, not a general company report.

## Hard rules

1. Use public professional/business sources only. No account intrusion, login bypass, impersonation, or private-data acquisition.
2. A title is not a name. `采购负责人`, `генеральный директор`, `CEO`, and explanatory sentences must never appear in `full_name`.
3. A named person is not enough. Verify current company relationship and decision relevance separately.
4. Generic email, switchboard, form, bot, or company social account is a company entry point, not a person's direct contact.
5. An inferred email is always `is_inferred=true`, `discovery_type=pattern_inferred`, and cannot be called verified unless independently confirmed.
6. Every current-employment, decision-role, or direct-contact claim must reference evidence IDs with public source URLs.
7. Search snippets alone are low confidence. Open the underlying public page or retain the claim as unverified.
8. If no person is found, return an empty `people` array and explicit search gaps. Never invent a person.

## Target strategy

- Small company: owner/general director, technical director, chief engineer.
- Medium manufacturer: procurement head, supply head, technical/production head.
- Large enterprise: category procurement, supply chain/MTO, supplier development, import-substitution lead.
- Distributor/platform: procurement, category manager, supplier development, product manager, commercial director.

Russian role terms include: `директор по закупкам`, `руководитель отдела закупок`,
`начальник отдела снабжения`, `директор по снабжению`, `МТО`, `категорийный менеджер`,
`технический директор`, `главный инженер`, `коммерческий директор`.

## Source order

1. Procurement/tender documents and public contract PDFs.
2. Official company team/news/requisites and downloadable documents.
3. Current job postings and employer pages.
4. Exhibitions, conferences, associations, patents, papers, and technical presentations.
5. VK, Telegram, LinkedIn, company news, and public professional profiles.
6. Registry/court documents for identity context; a legal representative is not automatically a procurement contact.
7. Email-pattern inference only after a real employee name and company email pattern are established.

Use Network Sentinel API search and public fetch/browser fallbacks. After a source is blocked, record it and switch sources instead of repeatedly retrying.

## Verification levels

- L3: named person + verified current employment + decision-relevant role + sourced direct contact.
- L2: named person + verified/likely current employment + relevant role + inferred personal contact; manual review required.
- L1: generic company entry or named employee without verified direct contact.
- L0: website only or no reachable entry.

The CRM server recalculates the level; do not inflate it.

## Output

Return one fenced JSON object conforming to `contact-recon-v1`, followed by a short Chinese summary.
The JSON must include `schema_version`, `job_id`, `customer_id`, `target_roles`, `people`,
`company_entry_points`, `evidence`, `search_gaps`, and `recommended_next_searches`.

Each person must include name, title, role category, decision role, employment status/confidence,
methods, proposed contact level, sales-ready flag, and quality issues. Each method must distinguish
direct/generic/inferred and include discovery and verification status. Each evidence item needs a
public URL and flags indicating whether it supports current employment or decision relevance.
