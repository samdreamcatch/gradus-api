## Upload 10 more resources (7 wrestling + 3 track & field)

Continue the existing pattern: upload to `resource-pdfs` bucket, insert rows into `public.resources`.

### Wrestling (continuing display_order from 80)

| # | Title | storage_path |
|---|---|---|
| 90 | Top and Bottom: Referee's Position and Why It Matters | wrestling/top-and-bottom.pdf |
| 100 | How Wrestling Is Scored: Points, Advantages, and Criteria | wrestling/scoring.pdf |
| 110 | The Tournament Format: How Wrestling Competitions Are Run | wrestling/tournament-format.pdf |
| 120 | Conditioning: Why Wrestling Is One of the Most Demanding Sports | wrestling/conditioning.pdf |
| 130 | Gear: Singlets, Headgear, Shoes, and Mat Safety | wrestling/gear.pdf |
| 140 | The Mental Side: Toughness, Resilience, and Losing Well | wrestling/mental-side.pdf |
| 150 | The Culture of Wrestling: What Makes the Sport Different | wrestling/culture.pdf |

### Track & Field (new sport — first 3 resources)

| # | Title | storage_path |
|---|---|---|
| 10 | Track & Field vs. Cross Country: Understanding the Difference | track_field/track-vs-cross-country.pdf |
| 20 | The Running Events: Sprints, Middle Distance, and Distance | track_field/running-events.pdf |
| 30 | Sprint Mechanics: What Good Form Actually Means | track_field/sprint-mechanics.pdf |

Sport key `track_field` (matches existing snake_case convention like `figure_skating`). All rows `published=true`, description blank.