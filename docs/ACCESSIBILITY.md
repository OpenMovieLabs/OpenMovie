# Accessibility and Localization

OpenMovie Desktop uses native semantic controls and keeps the full creator path keyboard-operable.
The shell provides a skip link, visible `:focus-visible` outlines, labeled icon buttons, live regions
for work and errors, modal focus trapping, Escape-to-close, focus restoration, and reduced-motion
CSS. Dialogs retain a visible heading through `aria-labelledby`; renderer loading state uses
`aria-busy` without disabling assistive technology navigation.

The localization foundation uses typed, in-repository catalogs. English and Simplified Chinese are
available from Settings; the choice is non-sensitive and stored only in browser-local application
storage. The root `lang` attribute updates immediately. New shell strings should be added to both
catalogs, while provider/model identifiers, paths and Movie IR remain untranslated data.

Current localization covers the navigation shell, home, primary task entry, runtime status and
application settings. Domain-editor strings can migrate incrementally without changing persisted
Movie IR or protocol values.

Release acceptance should include keyboard-only traversal at 200% zoom and a screen-reader smoke on
VoiceOver (macOS) and Narrator (Windows). Color is never the only status carrier: status labels and
text remain present alongside colored indicators.
