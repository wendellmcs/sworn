# The worst-case data

Step 5 of `sworn:design`. A screen tends to be built with easy data, such as a short name and a round number; real
users bring the cases below. Put each case into the screen that shows that kind of data, look at it, and fix what
breaks. A case that does not apply
to the screen is skipped, not faked. Fictitious data only: `example.com` and `.test` domains, invented names.

## People and names

| Case | Try | What usually breaks |
|---|---|---|
| very long | Maria Aparecida dos Santos Oliveira-Vasconcelos | the row height, the truncation, the avatar squashed |
| very short | Li, Bo | an alignment that assumed width |
| accents and other scripts | José Ñúñez, Zoë, 王小明, Иван | the font fallback, the initials of the avatar |
| right-to-left | محمد الأحمد, with `dir="auto"` on the element | the punctuation and the icon on the wrong side |
| emoji | 👩🏽‍💻 Ana, a family emoji made of several joined code points | `.length` counting, a truncation that cuts the emoji in half |
| extra spaces | "  Ana   Souza " | the trim, the double space shown |
| missing | no name at all | an empty cell or "undefined": show a fallback |

## Strings that do not break

| Case | Try | Fix |
|---|---|---|
| long e-mail | first.middle.last.department@subsidiary.example.com | `overflow-wrap: anywhere`, or truncation in the middle |
| long URL | https://docs.example.com/a/very/deep/path?with=query&and=more | the same |
| identifier | 3f2b9c4e-8a1d-4f6b-9e2a-7c5d1b0a9f3e | truncation in the middle keeps the start and the end |
| file name | relatorio-trimestral-final-revisado-v7.pdf | the extension stays visible |

## Labels and free text

| Case | Try | What usually breaks |
|---|---|---|
| long label | a button whose translation is 30% longer | the button wraps or overflows |
| compound word | Donaudampfschifffahrtsgesellschaft | no place to break the line |
| many tags | 15 tags on one item | the row grows without a limit: show "+12" |
| empty title | "" | a collapsed heading |
| markup in data | `<script>alert(1)</script>`, `<b>x</b>` | the text is rendered as HTML: escape it |
| line break in data | a description with three lines | the layout of a single-line field |
| very long text | 2000 characters | no clamp, no "show more" |

## Numbers

| Case | Try | What usually breaks |
|---|---|---|
| zero | 0 | "0 items" with the wrong plural, or the 0 hidden as if it were missing |
| one | 1 | "1 items" |
| thousands | 1284 | no separator in the user's locale |
| millions | 1000000 | the column width: use the compact form |
| currency | 1234.5 in BRL, USD and JPY | the decimals (JPY has none) and the symbol side |
| negative | -42 | the sign or the color missing |
| float error | 0.1 + 0.2 | 0.30000000000000004 on screen: round for display |
| over 100% | 140% | a progress bar that overflows its track |
| absent | null, NaN | "NaN" or "null" shown: show a dash and why |
| live change | a counter going from 9 to 10 | the layout jumps: `tabular-nums` |

## Collections

| Case | Try | What usually breaks |
|---|---|---|
| none | 0 items | no empty state |
| one | 1 item | a plural, a grid that stretches the single card |
| the page size, and one more | 20 and 21 when the page has 20 | the pagination |
| very many | 1000+ | no virtualization, the page freezes |
| one huge item | one item with ten times the data of the others | the row height of the whole list |
| identical names | two items with the same name | the user cannot tell them apart: show a second field |

## Time

| Case | Try | What usually breaks |
|---|---|---|
| now | the current second | "0 seconds ago" or "in 0 seconds" |
| the thresholds | 59 s, 61 min, 25 h, 6 and 8 days | the jump between relative and absolute |
| future | tomorrow | "-1 day ago" |
| very old | 1970-01-01 | an epoch zero shown as a real date |
| time zone | a date near midnight in another zone | the day shown is a day off |
| long duration | 125 hours | "5 days 5 hours" or "125:00:00", decided on purpose |

## Images

| Case | Try | What usually breaks |
|---|---|---|
| broken | an avatar URL that returns 404 | the broken-image icon: show the initials |
| none | no image at all | an empty box |
| extreme shape | a panorama 10:1 and a tall 1:10 | the image stretched: `object-fit` |
| transparent on dark | a transparent logo on the dark theme | a dark logo vanishes |
| slow | a 3 s load | the layout jumps when it arrives: `aspect-ratio` reserves the space |

## States around the data

| Case | Try | What usually breaks |
|---|---|---|
| loading | the request still running | a blank screen or a jump when it lands |
| server error | a 500 with a raw message | the stack trace shown to the user |
| timeout | a request that never answers | a spinner that never ends: a time limit, then the error state with a retry |
| offline | the connection lost mid-use | a silent failure: say so, keep what was typed, retry on reconnect |
| partial | half of the data loaded | a screen that looks complete |
| every value of a field | each status the API can return | a status with no style or no label |
| no permission | a user who can see but not change | a button that fails only on click |
| the current user | the user's own row | "you" not marked, or the action on oneself allowed |

## The environment

| Case | Try | What usually breaks |
|---|---|---|
| narrow | 320 px of width | the horizontal scroll |
| inside a sidebar | a 280 px column | a breakpoint that reads the window, not the container |
| very wide | 2560 px | lines too long to read, content lost in the middle |
| zoom | 200% | text cut off or overlapping |
| dark theme | the dark mode, when the project has one | hard-coded colors |
| right-to-left page | `dir="rtl"` on the root | margins and icons on the wrong side |
| touch | a phone | an action that only exists on hover |
