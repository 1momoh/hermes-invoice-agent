# Design audit: `/`, `/dashboard`, mobile

The baseline is commit 81da394 (the earlier invoice-book redesign). The result is this commit. Scores are out of 10 and self-assessed, and they are strict: a 10 means I couldn't find a defect worth fixing, not that the page is perfect. Lighthouse runs on its default mobile emulation against a local production build.

| Category | Before | After | What changed |
|---|---|---|---|
| Typography | 6 | 9 | Two families (Fraunces and JetBrains Mono), two weights each, a fixed type scale on 8px line heights, and tabular figures. The decorative handwriting accents are gone. |
| Spacing grid and alignment | 5 | 9 | Everything sits on an 8px scale. The header is 72px, the layout is a 1fr / 360px split, and the ledger totals share one ruled band. The hand-drawn circle and rotated elements broke the grid and have been removed. |
| Contrast (WCAG AA) | 6 | 10 | The muted ink (#8c857a, about 3.4:1) and the red failed AA. They're now #69635a and #b3301a, both at least 4.5:1 on paper. Lighthouse color-contrast now passes on both pages. |
| Focus states | 4 | 9 | There's a single 2px focus-visible ring on every control, plus a skip link and `aria-current` on the tabs. After a draft appears, focus moves to "Sign and send". The grid cells can be reached by keyboard. |
| Empty, loading and error states | 3 | 9 | Recent invoices and the ledger show skeletons, an empty state with a call to action, and an error state with "Try again". The ledger also handles a failed grid script. |
| Motion | 5 | 9 | Only the stamp landing (180ms) and the toast animate. Both are disabled under `prefers-reduced-motion`. The pulsing "online" dot is gone. |
| Responsiveness | 6 | 9 | Breakpoints at 960, 720 and 420. A mobile overflow caused by a `1fr` min-content grid item is fixed (`minmax(0,1fr)`). The ledger hides the NGN and PayPal-ref columns under 720px and stacks the totals. The rate chip stays visible. |
| Performance | 7 | 10 | Static responses are gzipped, AG Grid is cached for 7 days and loaded after `load`, and fonts use `display=swap`. |
| Copy | 6 | 9 | The copy is location-neutral ("Bill in your currency. Get paid through PayPal.") and the buttons say exactly what happens ("Sign and send", "Discard"). It explains plainly why PayPal needs USD. |

## Lighthouse (mobile)

| Page | Perf | A11y | Best practices | SEO |
|---|---|---|---|---|
| `/` before | 94 | 95 | 100 | 100 |
| `/` after | **100** | **100** | **100** | **100** |
| `/dashboard` before | 55 | 96 | 96 | 100 |
| `/dashboard` after | **96–97** | **100** | **100** | **100** |

Dashboard before: LCP was blocked behind about 1 MB of synchronous AG Grid JS, the console showed errors, and contrast failed. After: LCP 1.4 s and TBT around 200 ms. One informational audit remains (`valid-source-maps` for the vendored AG Grid bundle), and it doesn't affect the score.

## What still isn't a 10
- AG Grid's own header resize handles add some visual noise. A hand-built table would be lighter, but it would cost sorting and keyboard support.
- The type scale doesn't step down cleanly at 420px for very long email addresses, which get truncated with an ellipsis.
- No dark theme yet.
