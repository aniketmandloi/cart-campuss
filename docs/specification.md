# Car discovery and India buying research — build specification

This is the implementation handoff for a public car research web app. The product combines a curated car catalogue, market-source discovery, and transparent India purchase and financing scenarios.

The [decision map](https://github.com/aniketmandloi/cart-campuss/issues/1) is the canonical specification index. Each decision lives in its ticket's resolution comment; the question in the issue body is historical context. This file provides the reading order and asset links rather than a second copy of those decisions.

## Read before implementation

1. [Which sources can support a trustworthy worldwide car catalogue and market listings?](https://github.com/aniketmandloi/cart-campuss/issues/2#issuecomment-6342996569) — source strategy, permissions, and useful-content launch gate.
2. [What can India purchase-cost and affordability estimates reliably calculate?](https://github.com/aniketmandloi/cart-campuss/issues/3#issuecomment-6342998619) — evidence and limits of automatic calculations.
3. [What is the first-release promise and verified coverage boundary?](https://github.com/aniketmandloi/cart-campuss/issues/4#issuecomment-6343209541) — catalogue scope, journeys, and trust states.
4. [How should India cost, EMI, and affordability scenarios behave?](https://github.com/aniketmandloi/cart-campuss/issues/5#issuecomment-6343212139) — component accounting, formulas, and output classes.
5. [Which domain model and architecture support traceable car information?](https://github.com/aniketmandloi/cart-campuss/issues/6#issuecomment-6343214890) — identities, evidence, publishing, and technical boundaries.
6. [What discovery flow and car-page design best communicate the product?](https://github.com/aniketmandloi/cart-campuss/issues/7#issuecomment-6343217401) — routes, hierarchy, responsive behavior, and accessibility.
7. [What delivery stages and launch gates make the specification build-ready?](https://github.com/aniketmandloi/cart-campuss/issues/8#issuecomment-6343220076) — build sequence, measurable acceptance, and launch prerequisites.

Use the root [glossary](../GLOSSARY.md) for domain terminology.

## Planning asset

[Car-page concept](design/car-page-concept.html) is a self-contained design study with credited reference car imagery and explicitly illustrative specification, purchase-cost, and finance data. It is not an implemented website, a live listing, or a verified purchase quotation. The UX resolution defines what the eventual application must do; an illustrative screen cannot override its data and calculation contracts. The user-requested visual revision is documented in the [Taste v2 review](design/taste-review.md), including its direction, asset credits, and verification limits.

## Research evidence

- [Car data and listings feasibility](https://github.com/aniketmandloi/cart-campuss/blob/0032c2d6193b9b33cdb8fd8196dadd8af469bcf5/docs/research/car-data-feasibility.md).
- [India costs and finance feasibility](https://github.com/aniketmandloi/cart-campuss/blob/587ef7a282ec7fed85ef89872e0dc7b5051fbde4/docs/research/india-cost-feasibility.md).

Both notes record an investigation dated 22 October 2026, including facts not established and access not obtained. They remain on pushed research branches and are never merged. Research recommendations are evidence for the canonical resolutions, not independent product requirements or legal certifications.

## Handoff boundary

The next work is implementation in the sequence defined by the delivery decision. No application scaffold, installed dependencies, development server, production deployment, signed data contract, provider credential, or complete current tax-rule dataset is supplied by this planning effort.

Source permissions and real catalogue content are public-launch execution gates. A build can begin against labelled fixtures; an empty factual catalogue cannot be substituted for the specified product. The chosen first release needs no automatic tax feed or assumed paid inventory integration.

The user starts development servers and performs website visual checks. Automated implementation checks and the exact screen checks are specified in the delivery and UX decisions; they have not passed merely because the plan exists.

## Initial planning verification performed

- Confirmed seven native GitHub sub-issues in map order, with assignments and only wayfinder labels, and confirmed both research commits are accessible remotely.
- Previewed the concept at 728 and 360 CSS pixels: no horizontal overflow or console errors; keyboard tabs and the cost panel worked. The synthetic loan example produced the expected 9% and zero-interest payments.
- Independently checked the specification's amortization rounding and income constraints using Python Decimal arithmetic, including zero closing balance and cash/interest reconciliation.
- Checked local document links and Git whitespace before committing this handoff.

No application formatting, typecheck, build, integration, performance, or website accessibility suite ran: no application or project test tooling exists yet. The design study and arithmetic checks do not establish production readiness.
