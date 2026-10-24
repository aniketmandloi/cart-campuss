# Car-page concept — Taste v2 review

## Brief and scope

Improve the existing car-detail planning concept using the user-requested Taste skill. This is a visual iteration of a self-contained design study, not implementation of the full application or a change to the sourced-data and finance contracts.

Taste source: [design-taste-frontend](https://github.com/Leonxlnx/taste-skill/blob/6010f91a9935f1c167dfc500fb1a475681892e6b/skills/taste-skill/SKILL.md), commit `6010f91a9935f1c167dfc500fb1a475681892e6b`. The skill was read from a temporary checkout for this request; no project dependency or global skill installation was added.

## Direction

App-screen route, kind `markets`, screen `detail`. The draw offered True-black flat and Data terminal. Chosen: **True-black flat**, seed **887344209**, without redraws. Researching a car and considering a purchase calls for a calm media/detail workspace rather than a trading terminal.

The screen's question: **What is this car, and what would my stated India purchase scenario cost?**

Face: neutral graphite surfaces, actual car photography, and the dealt Inter font with tabular figures. The signature element is the car's technical dossier alongside its India acquisition ledger. Elevation comes from lightness steps; chrome is neutral, the main action is inverted white, and any sport accent is confined to data.

## Data and jobs inventory

- Brand, Model, Generation, SalesMarket, ModelYear, and variant context remain distinct.
- One real reference photograph identifies the pictured car; it is not an available vehicle or listing.
- Technical figures in the design are sample content rather than a licensed specification feed.
- Production count stays unknown unless separately evidenced.
- Purchase components are explicitly illustrative quote entries, never automatically inferred taxes.
- Component sums come from the displayed amounts; no item is charged twice.
- Principal, nominal annual interest, and whole-month tenure drive the loan example.
- The primary job is to inspect the India cost and financing scenario.
- Secondary jobs are reading specifications and reviewing source-discovery plans.
- The mobile composition folds navigation and preserves readable amounts and thumb targets.

## Before — screenshot critique

ROUND 0

Seen in one second: a beige documentation panel and an abstract car silhouette.

Idea: the car reference and India estimate are present but visually subordinate to explanation text.

Live thing: section tabs and a synthetic EMI form.

Layout words by section: identity=split / facts=strip / details=short-card / costs=tall-card / finance=full-width-card.

Screens inspected visually in T3 HTML previews: 1440px (1134px content height), 768px (1160px), and 390px (1765px).

Top three problems:

1. At 1440px and 768px, the overview ends hundreds of pixels before the adjacent cost card, leaving a conspicuous unused left column. Rebalance useful content and let the car photograph carry its share of the frame.
2. At all widths, instructional paragraphs, many missing-value labels, cream/rust styling, and tracked uppercase captions compete with the vehicle identity. Use a quieter app hierarchy and a useful clearly labelled worked scenario.
3. At 390px, the anonymous silhouette and long explanatory blocks delay the useful cost/finance interaction. Put actual car context and the next action earlier, with navigation folded away.

The original source failed Taste app lint with **1 FAIL, 0 WARN**: its decorative radial-gradient background. This is a lint result, not the full browser inspector.

## Asset credits

- Photograph: **Porsche 911 GT3 RS (2022) 1X7A7164**, by **Alexander-93**, [source](<https://commons.wikimedia.org/wiki/File:Porsche_911_GT3_RS_(2022)_1X7A7164.jpg>), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Downloaded at 1280 × 621. Resized by the source service; no additional crop or recoloring is intended. Image rights remain CC BY-SA 4.0. The concept must include source/author/license credit beside its closing evidence note.
- Font: **Inter**, copyright 2020 The Inter Project Authors, [project](https://github.com/rsms/inter), [SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt). The local variable Latin subset is embedded for offline rendering; the license is included in `assets/Inter-OFL.txt`.

Portable source metadata is recorded in `assets/credits.json`. No generated photograph, unrelated car photo, hotlinked image, external font request, or network script is needed.

## Verification boundary

The project's instruction says the user starts every development server and checks websites by hand. Taste's `inspect.mjs` serves local files through a temporary local server, so it is not run. Its complete 0-FAIL browser-inspector result is not claimed. T3's server-free HTML previews, screenshot critique, skill lint, and focused interactions provide proportionate checks for this standalone artifact. No development server, simulator, application build, or deployed website is started.

## After — first render and focused fixes

ROUND 1

Seen in one second: a recognisable Porsche and an aligned India acquisition ledger.

Idea: the car's technical dossier meets its India acquisition ledger.

Live thing: car-section navigation, the cost action, and adjustable nominal-rate EMI.

Layout words by section: shell=compact navigation / car=photograph and dossier / cost=ledger / finance=embedded workbench.

The first revised render was visually inspected at 1440px (924px content height), 768px (1772px), and 390px (1867px). All three rendered without console errors. Taste app lint on that revision returned **0 FAIL, 0 WARN**.

Top three problems and disposition:

1. At 390px, the cash total squeezed its label and caveat into a very narrow column. Stack the label above the amount on phones.
2. At every width, the sample-data notice appeared only at the foot of the screen. Move it before the example figures, retaining the detailed image credit at the foot.
3. The collapsed-menu tab handler closed the menu before focusing a newly selected tab, and the always-visible ledger was incorrectly another tabpanel. Keep the mobile tablist open for arrow-key navigation and treat the ledger as a separately named region.

The completed focused edits remove outside frame padding, make the domestic-route wording explicit, add useful generation context, and keep Save responsive when browser storage is unavailable. These are finishing changes to the same selected direction, not a redraw.

### Sample-data inventory

The car name and licensed photograph identify the 2022 Porsche 911 GT3 RS. Technical values (including the shown power and configuration) are illustrative design content and must be replaced or verified under the sourcing policy before product publication. Production remains unknown. There are no live listings, sellers, stock counts, loan offers or market-average claims.

All example purchase amounts are synthetic entered components: vehicle-only quote INR 42,000,000; insurance INR 800,000; registration/road tax INR 3,500,000; collection charges INR 1,500. The displayed sum is INR 46,301,500. Accessories and warranty are not selected, financing fees are outside the acquisition sum, and no import assessment is performed. No tax rate is computed.

The independent loan example starts at principal INR 25,000,000, nominal annual rate 9%, and 60 months. It displays the regular closed-form instalment only, not an APR, interest total, amortization schedule, lender approval or final payable amount. Personal loan inputs are not persisted.

## Final render and app-screen critique

ROUND 2

Seen in one second: the photographed car; the adjacent highlighted cash scenario on desktop.

Idea: the car's technical dossier meets its India acquisition ledger.

Live thing: section navigation and adjustable EMI, with direct focus into the cost workbench.

Layout words by section: shell=compact navigation / car=photograph and dossier / cost=ledger / finance=embedded workbench.

Final screenshots inspected: 1440px (906px content height), 768px (1815px), 728px (1796px), 390px (1868px), and 360px (1891px).

1. **Question and hierarchy:** the car image identifies the subject first. The largest cash figure answers the entered acquisition scenario; the EMI is a separately labelled loan result. On phones the primary cost action is visible before the dossier.
2. **Edges and space:** desktop panels use the canvas with shared edges and similar lengths. Phones stack complete panels with a consistent gutter. No clipped amount, accidental empty half-column or horizontal overflow appears at the checked widths.
3. **Colour and face:** true-black/graphite surfaces and Inter hold the screen. The lime highlight is confined to the cash result. Navigation is neutral and the primary action is white.
4. **Arithmetic and duplication:** the four displayed components sum to INR 46,301,500. Power, body, transmission and drivetrain agree across Overview and Specs. The nominal 9%, 60-month loan on INR 25,000,000 yields INR 518,958.88 to two decimals; it is explicitly independent of the cash sum. Figures use tabular numerals and aligned amount columns.
5. **Zero and unknown:** a zero principal displays INR 0.00 and “Cash purchase.” Production is explicitly “Unknown,” not zero. No queue badges or invented counts are present.
6. **Labels and encodings:** there are no charts or ambiguous legends. Phone total labels now stack above the amount. No text collisions were visible at the checked widths.
7. **Phone composition:** navigation folds into Menu, actions wrap, inputs become full-width, and the cost breakdown follows the dossier. Each block retains its question and labels.

The three visible problems from Round 1 are resolved. Remaining limits are deliberate scope boundaries: the reference photograph has a busy real-world background; the phone page requires scrolling; this single-car study does not demonstrate search, variant selection, a multi-car comparison, income suggestions or the complete production finance engine. A licensed reference image does not grant permission for an arbitrary future catalogue image.

### Verification results

- Taste app lint: **0 FAIL, 0 WARN** on the final HTML.
- All five preview diagnostics passed: embedded Inter/photo loaded, no page-level horizontal overflow, sample notice above the figures, component sum, section switching, arrow-key tab navigation, cost-action focus, regular EMI, zero interest, zero principal, invalid fractional months, Save and Compare toggles. The collapsed-menu checks also passed Escape focus restoration. The 360px run blocked browser storage and Save still toggled.
- Inline JavaScript passed `node --check`. Embedded photograph/font bytes match their credited local originals. The file loads no remote image, font or script and contains no diagnostic logging.
- The prototype uses browser-number arithmetic for this design demonstration. Decimal arithmetic, the specified rounded payment schedule, income rules and wider financial edge cases remain implementation work under the cost specification.
- No application build or full browser inspector ran; no server was started. These checks do not establish WCAG conformance or production readiness.

Human visual check: open `docs/design/car-page-concept.html` directly, inspect desktop and phone widths plus 200% zoom, open Menu and use arrow keys/Escape, choose Specs/Market, use Open India cost, and edit the three loan inputs. Check that the total remains legible and the photograph/license credit remains accessible. Save persistence can be checked in a browser that permits storage for local files.
