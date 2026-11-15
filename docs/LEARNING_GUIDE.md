# Learning guide

A walkthrough of the ideas in this case study, in the order that is easiest to learn them. Every concept maps to a small, tested file you can read and change.

## The story
A delivery rider or e-hailing driver wants a small loan. Banks can't assess them (no payslips), but the gig platform knows exactly what they earn each week. A heavy rainstorm during working hours cuts a rider's income, so a **weather guarantee** pays that week's loan installment to the lender, which keeps the rider from falling behind. The rider never receives cash from the guarantee.

## Reading order

| # | Idea | What to read | Try it |
|---|---|---|---|
| 1 | **Alternative credit scoring**: judge ability to repay from earnings patterns, not bank statements | `src/engine/underwriting.ts` | Simulators → Underwriting: drag weekly earnings and volatility |
| 2 | **Affordability-capped repayment**: take a small slice of each week's income, never more than a cap | `src/engine/repayment.ts` | `tests/repayment.test.ts`: slow weeks, windfall weeks |
| 3 | **Graduation**: reward good repayers with bigger limits | `src/engine/graduation.ts` | Borrowers page → open a closed loan |
| 4 | **Parametric triggers**: pay on a measurable event, not on proof of loss | `src/engine/weather/trigger.ts` | Simulators → Weather trigger |
| 5 | **Calibrating thresholds from history** | `src/engine/weather/thresholds.ts` | Change region and watch the trigger level move |
| 6 | **Pricing risk that varies by season** | `src/engine/pricing.ts` | Simulators → Pricing: compare May vs November |
| 7 | **Embedded finance**: the loan is offered inside the partner's app via a signed API | `src/server/webhook.ts`, `src/engine/partners/` | Simulators → Partner webhook |
| 8 | **Async back-office pipelines and SLAs** | `src/engine/pipeline/` | Originations page → expand an application |
| 9 | **Feature stores for future ML** | `src/engine/pd/features.ts`, PD page | Read the feature list |

## Questions to think about
- Why does the trigger need *three* conditions (severity, working hours, location) instead of just "it rained"?
- A guarantee pays the lender, not the rider. What changes legally and commercially if it paid the rider?
- The fee is priced from expected claims. What goes wrong if the exposure curve is wrong by 2×?
- Weeks paid by the guarantee don't count as late for graduation. Is that fair? What would gaming look like?
- What data would you need to replace the placeholder numbers with real ones?

## Exercises
1. Add a new facility stage and make the tests pass.
2. Change the working window to 06:00–22:00 and see which tests and simulator results change.
3. Add a second trigger type (e.g. extreme heat) as a new check in the evaluator.
4. Replace the in-memory store with a database using the provided schema.

## What is deliberately fake
Borrowers, rainfall history, credit bureau responses, partner platform names, exposure curves, APRs, limits and loss ratios. The *mechanics* are the point, not the numbers.
