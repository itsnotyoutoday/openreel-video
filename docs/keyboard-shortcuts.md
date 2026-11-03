# Keyboard shortcuts

Every default binding of the editor. Bindings can be changed in the shortcuts dialog (press `?`), and the
presets (CapCut, Premiere, Final Cut, DaVinci) only override the few keys they list, so everything here
applies in all of them unless a preset says otherwise.

Shortcuts act only while the editor has focus: not in text fields, dialogs or menus. When the editor is
embedded in a host page they react only to keys pressed inside the editor root.

## Playback

| Key | Action | What it does |
| --- | --- | --- |
| `Space` | Play/Pause | Toggle playback |
| `Left` | Frame Back | Move back one frame |
| `Right` | Frame Forward | Move forward one frame |
| `Shift+Left` | Second Back | Move back one second |
| `Shift+Right` | Second Forward | Move forward one second |
| `Up` | Jump 5s Back | Move back 5 seconds |
| `Down` | Jump 5s Forward | Move forward 5 seconds |
| `Home` | Go to Start | Jump to timeline start |
| `End` | Go to End | Jump to timeline end |
| `[` | Previous Clip | Jump to previous clip edge |
| `]` | Next Clip | Jump to next clip edge |
| `I` | Mark Loop Start | Set the preview loop start at the playhead |
| `O` | Mark Loop End | Set the preview loop end at the playhead |
| `Shift+L` | Toggle Preview Loop | Repeat the marked range or the full timeline |
| `J` | Shuttle Reverse (J) | Play in reverse; press again for 2x, 4x, 8x. With K held: frame back, hold for slow reverse |
| `K` | Shuttle Stop (K) | Stop shuttle playback. Hold K and tap J or L to step a frame |
| `L` | Shuttle Forward (L) | Play forward; press again for 2x, 4x, 8x. With K held: frame forward, hold for slow forward |

## Editing

| Key | Action | What it does |
| --- | --- | --- |
| `Cmd/Ctrl+Z` | Undo | Undo last action |
| `Cmd/Ctrl+Shift+Z` | Redo | Redo last undone action |
| `Cmd/Ctrl+X` | Cut | Cut selected clips |
| `Cmd/Ctrl+C` | Copy | Copy selected clips |
| `Cmd/Ctrl+V` | Paste | Paste clips at playhead |
| `Cmd/Ctrl+D` | Duplicate | Duplicate selected clip |
| `Delete` | Delete | Delete selected clips |
| `Shift+Delete` | Ripple Delete | Delete and close gap |
| `S` | Split | Split clip at playhead |
| `Q` | Trim Start | Trim clip start to playhead |
| `W` | Trim End | Trim clip end to playhead |

## Selection

| Key | Action | What it does |
| --- | --- | --- |
| `Cmd/Ctrl+A` | Select All | Select all clips |
| `Esc` | Deselect | Clear selection |

## Timeline

| Key | Action | What it does |
| --- | --- | --- |
| `N` | Toggle Snap | Toggle snapping |
| `Cmd/Ctrl+=` | Zoom In | Zoom in timeline |
| `Cmd/Ctrl+-` | Zoom Out | Zoom out timeline |
| `Cmd/Ctrl+0` | Fit Timeline | Fit timeline to view |

## View

| Key | Action | What it does |
| --- | --- | --- |
| `?` | Show Shortcuts | Show keyboard shortcuts |

## File

| Key | Action | What it does |
| --- | --- | --- |
| `Cmd/Ctrl+S` | Save | Save project |
| `Cmd/Ctrl+E` | Export | Export video |

## Tools

| Key | Action | What it does |
| --- | --- | --- |
| `T` | Add Text | Add text clip |
| `M` | Add Marker | Add marker at playhead |

## Shuttle (J, K, L)

The same J/K/L keys most video editors use for fast playback and review.

| Keys | Result |
| --- | --- |
| `L` | Play forward. Press again for 2x, 4x, then 8x. |
| `J` | Play in reverse at 1x. Press again for 2x, 4x, then 8x. |
| `K` | Stop. |
| `J` while going forward, `L` while going back | Switch direction, starting at 1x. |
| Hold `K`, tap `L` or `J` | Step one frame forward or back. |
| Hold `K`, hold `L` or `J` | Play slowly (quarter speed) forward or in reverse while the key is down. |

Forward playback up to 4x uses the normal player, with sound. Reverse, 8x and slow motion move the playhead
frame by frame instead (the preview shows each frame, without sound). Shuttle ends at the start or end of the
timeline, when the window loses focus, or when playback is stopped another way.
