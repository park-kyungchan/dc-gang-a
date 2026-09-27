# SPT classroom direction — structural extraction

Source: `/opt/data/workspaces/spt/docs/classroom-product-direction.md` (host path `/docker/hermes-agent-2q3y/data/workspaces/spt/docs/classroom-product-direction.md`). This extraction uses the authority, academy-destination, diary-contract, classroom-semantics, UI-scope, and source-route sections. The source's real-use observation section and supporting private evidence were deliberately not copied.

## Teacher cycle and state

- The classroom app is intended to support one teacher managing several students' changing activities with fast touch actions. Assignment, work, completion, teacher check, and mastery remain separate states.
- It retains auditable student/day/event/audio records. After class, native voice memo evidence can inform teacher-reviewed short- and long-term records; live classroom state must remain usable without AI or transcription.
- Viewing a student does not assign a recording to that student. Recording subject/session, source evidence, local drafts, and viewed student remain separate identities.

## Academy and parent destination

- The academy site's DayRecord is the intended destination for reviewed diary input. The site's existing previous-lesson progress/homework/memo display can carry forward prior entries; a second carry-forward store should not be assumed necessary.
- A DayRecord DailyTest value is a teacher judgment about that lesson and has different grain from measured DT/ZT attempts. Neither should silently overwrite the other.
- The teacher reviews the progress, homework, and parent-facing memo draft. Academy diary entry, separate student-report save, and parent batch delivery are distinct steps. Report save and sending remain teacher actions in this dated direction.
- Raw evidence and drafts stay private; shared Sheets receive only audience-appropriate, teacher-confirmed projection fields. Sheet/Tracker reflection alone is neither academy DB save nor parent delivery.

## Source and interface implications

- The SPT direction names simple student/day/event/audio tables and the original Tracker UI as related, separate owners. It does not provide a verified student-app backend schema.
- Date/lesson occurrence, student/source identity, curriculum/book/TOC range, activity fact, diary field, report projection, and delivery state need distinct joins and provenance.
- The original Tracker workbook/tab identity is recorded in the source, but UI implementation status and deployment authority are owned by the SPT project's current work record and require fresh readback.

## Limits

This is a structural extraction from a dated project direction, not a copy of its real-use observations, an assertion of current deployment status, or authorization to write a live student record. No SPT code, student row, voice memo, or protected evidence was accessed or copied for this extraction.
