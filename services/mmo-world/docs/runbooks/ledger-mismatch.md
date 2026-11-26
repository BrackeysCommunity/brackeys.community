# Runbook: a ledger mismatch

The conservation check says coin or goods do not add up.

## Symptoms

- The daily check logs `conservation check found discrepancies` with a
  `count` and the `first` line, instead of `conservation check holds`.
- PostHog's `mmo_conservation` event carries `discrepancies` above 0.
- `op audit` prints a non-empty `discrepancies` list.

## Checks, in order

1. **Read `op audit`.** Each line is one of three shapes:
   - `<asset> sums to <n> over all accounts`: the ledger itself does not
     balance; something minted or destroyed.
   - `transaction <id>: <asset> sums to <n>`: one stored transaction does
     not balance; its id points at the command or tick that wrote it.
   - `<account>: ledger <n> <asset>, state <m>`: what an account holds in
     the ledger differs from what the world says it holds.
2. **The account.** For a `char:<id>` account, `op inspect character <id>`
   shows what the character holds, its long action and its flags. A
   `pool:` account names the tile, floor or purse it lies in; `src:` and
   `sink:` accounts name the rule that gives or takes.
3. **The faucet.** `op economy` prints coin per active character, the rate
   and the characters flagged for review: a flagged character beside a
   minted asset is the first lead.
4. **When it began.** `op replay` over the last world day checks that the
   recorded ticks replay; the day's house log (`op house-log`) shows the
   operator and staff commands that ran.

## The fix

- The cause is a rule or a save path, so the fix is a code deploy. Never
  edit `mmo.*` by hand: the world checks its rows on every load, and an
  edit breaks the replay of every tick after it.
- Once the cause is fixed, make a player whole with `op correct <id> <asset> <units> <note...>` (coin, provisions or `mat:<id>`; negative
  takes). A correction is a recorded command and a `ledger.corrected`
  fact, moved from or to the operator's account, so it keeps the ledger
  balanced and replays.
- A correction moves the ledger and the holding together, so it cannot
  close a `ledger <n>, state <m>` gap. That gap needs the code fix to
  bring the two together, or a restore of the last clean backup
  ([../backups.md](../backups.md)), which loses the play since.

## After

- `op audit` prints no discrepancies.
- The next daily check logs `conservation check holds`.
- `op economy`'s coin per active character is where it was before the
  fault.
