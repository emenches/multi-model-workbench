# Cogitor brand direction (working design brief)

**Status:** Proposed visual direction; not a finalized logo, trademark clearance, or release claim.

## Name and literary reference

Cogitor is a reference to the ancient thinkers from the *expanded Dune* novels by Brian Herbert and Kevin J. Anderson: philosophers who preserve their brains in canisters for extended contemplation. The relevant qualities are reflection, multiple perspectives, and deliberate synthesis, rather than the more familiar sandworm or House imagery.

Cogitor the app should **not** imply affiliation with the Dune franchise, its publishers, or rights holders.

## Original logo direction

- **Symbol:** a small luminous core framed by three or four discrete orbiting/connecting arcs, suggesting independent minds and a shared synthesis. A container or central chamber silhouette may reference the cogitor concept abstractly without depicting recognizable Dune props.
- **Shape:** simple recognizable silhouette at 16px and 32px; single-color version first; optional muted copper accent on dark charcoal, with good contrast.
- **Wordmark:** Cogitor; clean geometric humanist type with balanced round letters, not a replica of a film/game title font.
- **Avoid:** Dune movie typography, franchise symbols, direct character illustrations, brain-in-jar imitation of fan art, spice/sandworm motifs, or reused copyrighted artwork.
- **Deliverables after approval:** original SVG icon and wordmark, native Windows/macOS/Linux icons, splash/about copy, browser/site favicon.

## Rollout and privacy

UI naming may change independently from app identity, bundle ID, settings keys, provider profiles, GitHub release URLs, and original upstream license/attribution. Do not change native app identifier or storage keys in a cosmetic rename: that could strand users' signed-in sessions or history.

The planned public repository **Security & Privacy** section must describe only tested facts. Before claiming that native provider views have restricted IPC, settings are written with owner-only permissions, or adapter redirects are constrained, merge the reviewed security series, pass CI, and complete macOS acceptance tests. Describe remaining risks transparently (mutable adapter updates, native scripting privileges, and persistent local content). No blanket "secure", "private by design", "end-to-end encrypted", or audited certifications without evidence.
