# Splat assets

Private Gaussian-splat scans of the hallway stay **local only** and are
excluded from Git by `.gitignore` (`*.ply` and friends are ignored).

Current expected file for the viewer build: `../models/hallway.ply`
(INRIA-style 3DGS export, ~266k splats).

Deliberately public synthetic fixtures belong in `tests/fixtures/synthetic/`
instead, which is tracked.