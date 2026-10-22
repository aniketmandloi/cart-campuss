# Car discovery and buying research

A shared language for exploring cars worldwide and understanding what buying one in India would involve.

## Language

**Brand**:
The marque under which a car is marketed, distinct from the corporate group that may own it.

**Model**:
A named family of cars sold by a brand, spanning its generations and variants. A Model describes a kind of car rather than an individual vehicle offered for sale.
_Avoid_: Listing, individual car

**Listing**:
A source-specific seller offer for an individual vehicle or clearly specified dealer stock, with its own location, condition, price basis, and availability. A manufacturer's general price reference is not a Listing.
_Avoid_: Model, universal car price, manufacturer price list

**Generation**:
A distinct design iteration of a Model, potentially spanning several model years and market-specific variants.

**MarketVariant**:
A particular powertrain, body, transmission, and trim configuration offered within a Generation in a SalesMarket.
_Avoid_: Universal trim

**ModelYear**:
A year label assigned under a manufacturer's or market's convention; it need not equal the calendar year a vehicle was built or registered.

**SalesMarket**:
The country for which a variant, specification, or official price is offered. It is distinct from a seller's location and the intended registration jurisdiction.

**RegistrationJurisdiction**:
The Indian state or union territory where the buyer proposes registering a vehicle.

**Vehicle**:
An individual physical car, distinct from its Model, configuration, and any offers to sell it.

**PriceReference**:
A dated manufacturer or other identified source's price for a scoped car configuration, with its currency and inclusions. It does not establish that a particular vehicle is available.
_Avoid_: Listing, final on-road price

**ProductionClaim**:
A sourced count of planned or completed production with an explicit vehicle scope, geography, and period. Sales and registration counts are different claims.
_Avoid_: Sales total, unspecified rarity score

**AuctionEvent**:
A publisher's scheduled or completed auction containing one or more lots.

**AuctionLot**:
A car offered within an AuctionEvent, with its own sale status and distinctly labelled guide, bid, or sale amounts.

**SourceDirectory**:
A set of outbound links to relevant manufacturers, dealers, marketplaces, or auction publishers. It does not claim individual inventory or current availability.
_Avoid_: Live listings

**PurchaseQuote**:
A seller's or specialist's dated statement of proposed purchase amounts, inclusions, and exclusions for a particular buying context.
_Avoid_: Guaranteed final price

**CostScenario**:
A buyer's hypothetical purchase and financing calculation under stated inputs, location, date, and assumptions. It is distinct from a quoted offer or a sourced vehicle fact.

**KnownSubtotal**:
The sum of resolved cost components when other relevant components remain unknown. It is not a complete purchase price.
_Avoid_: Final price, all-in total

**EMI**:
The equated monthly instalment of a loan under specified principal, nominal interest, tenure, and repayment assumptions.
_Avoid_: Average finance amount

**TakeHomeIncomeScenario**:
A suggested monthly income under explicit car-cost and existing-commitment budget ratios. It is not a lender's salary requirement or credit decision.
_Avoid_: Salary required, loan eligibility
