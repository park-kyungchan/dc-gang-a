# LMS automation source

This directory contains the `ganga` package and its original source tests,
imported for the Daechi Whole-Lens workspace. The original repository's
student databases, credentials, legacy folders, quiz transcripts, and old
agent instructions were intentionally excluded. See the repository root
`AGENTS.md` and this directory's `AGENTS.md` before running any code.

The current Main Sheet task is the 14:00 whole-class preparation screen. Its
backend read boundary is in `../docs/WHOLE_LENS_READ_CONTRACTS.md` and the
canonical registry at `../research/backend-map/route-registry.json`. The
import does not establish current LMS authentication or any app submission,
grading, or correction join.

Use Python 3.12. Install dependencies from `requirements.txt` only when
working on this package in a dedicated local environment. Review a test's
effects and old privacy assumptions before running it; the whole historical
suite is not the portable Main Sheet acceptance gate.
