# Participant recordings

Six user-supplied recordings, added with explicit publication approval on
5 November 2026. The originals remain unchanged outside this repository.

| Recording | Duration | Processing |
| --- | --- | --- |
| [Sam](sam.mp4) | 3:35 | Trimmed from 4:32.47 at 215 seconds, keeping the final audio and a short white hold; removes the long blank/standby tail. |
| [Ria](ria.mp4) | 2:56.63 | Original bytes. |
| [Massimo](massimo.mp4) | 2:43.90 | Original bytes. |
| [Mags](mags.mp4) | 3:02.83 | Original bytes. |
| [Iris](iris.mp4) | 3:51.70 | Original bytes. |
| [Max](max.mp4) | 1:44.50 | Original bytes. |

Sam's H.264 video and AAC audio were stream-copied without re-encoding, resizing
or quality changes. AAC packet alignment makes the output container
215.018667 seconds long. The original recording is 272.466633 seconds; about
57.45 seconds of tail were removed. The last detected non-silent audio is
around 213.16 seconds at a -60 dB threshold.

All six MP4s use **Git LFS**, including the trimmed Sam file, which remains
larger than GitHub's ordinary-file limit. A clone with Git LFS installed checks
out the full recordings; if only pointer text appears, run `git lfs pull` in
your own checkout. No original source recording is overwritten.

[manifest.json](manifest.json) records source/output sizes, durations, stream
formats, SHA-256 hashes and the trim settings. These are recordings of runs,
not proof of current calibration, physical alignment or headset acceptance.
