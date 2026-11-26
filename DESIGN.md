# StickerForge Desktop

The workspace is built around a square proof of the sticker. The editor pairs this canvas with a compact property inspector and places trimming beneath the proof. At narrow widths, navigation becomes horizontal and the inspector follows the proof and timeline. The dashboard uses activity rows and a small set of measured counts.

Neutral canvas and inspector surfaces distinguish viewing from editing. Emerald marks selection, focus and the primary action. Segoe UI follows the native Windows typography. Tabular numerals clarify time and byte readouts. Lucide icons reinforce action labels.

The frontend-design-orchestrator guided the composition and responsive layout. Impeccable informed the operational hierarchy and restraint. Taste Skill informed the asymmetric composition and use of grouped controls in normal flow. Emil Kowalski informed short, interruptible press feedback and reduced-motion support.

## Rendered review

| Before | After | Why |
| --- | --- | --- |
| Navigation buttons compressed their text at 390 px | Buttons retain their natural widths inside the scrollable navigation strip. The selected item scrolls into view | Keeps every label legible and preserves keyboard navigation |
| The local web view requested a missing favicon | The HTML entry points to the StickerForge application icon | Keeps the browser and desktop release on the same visual identity |

Playwright exercised all eight screens at 1440, 1280, 1024, 768, 430 and 390 px. The review also checked keyboard focus, language and theme changes, import errors and the disabled export state. The Windows captures come from the running Tauri application. The media and collection in the history and pack captures are synthetic QA fixtures.

[Windows overview](docs/screenshots/windows-overview.png) · [Sticker Studio preview](docs/screenshots/windows-studio-render.png) · [Export history](docs/screenshots/windows-history.png) · [Packs](docs/screenshots/windows-packs.png) · [390 px browser layout](docs/screenshots/studio-390.png)

The working Sticker Studio capture uses the public CC0 flower video in MDN's examples. [Source media](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4)
