---
title: MAPIMS EFS
aliases:
  - Employee Feedback System
tags:
  - project
  - mapims
  - efs
created: 2026-10-30
---

# MAPIMS Employee Feedback System (EFS)

Converted from the patient feedback app (see [[MAPIMS Feedback System]] and [[MAPIMS Feedback Workflow]], which still describe the original PFS flow). Same stack: Express + MongoDB + React/Vite, AI sentiment via OpenRouter, ticketing, dashboards, roles, voice and bot modes.

## Feedback types

| Type | Source form | Fields asked |
|------|-------------|--------------|
| `new_joiner` | 15-Day Stay Interview | Employee ID, Name, Department, Date of joining + open questions |
| `relieving` | Employee Exit Interview | Employee ID, Name, Department, Date of joining, Last working day + questionnaire |
| `general` | open feedback | Employee ID, Name, Department (date of joining optional) + emoji rating and comments, or Voice Guide / voice |

Questions live in `backend/src/employeeQuestionnaires.js` (English + Tamil, all open-ended). The form loads them from `GET /api/questionnaires/:type`, so the server is the only copy.

## Public flow

`/welcome` → pick a type
- New joiner → `/feedback/give?type=new_joiner`
- Relieving → `/feedback/give?type=relieving`
- General → `/feedback/general` (Voice Guide, Voice, Rate & share) → `/feedback/give?type=general` or `/feedback/bot`

Then `/thank-you`. 

## How answers are read (no tickets)

Every question in the new-joiner and exit questionnaires is open: the employee speaks or types the answer in their own words. There are no Yes/No, rating or option buttons.

The server validates `answers[]`, flattens them to `comments` (Q:/A: text), and the AI reads that text for the overall rating and sentiment.

- A Red "immediate blocker" answer forces rating 1. It is only a flag for HR; nothing is raised or assigned.
- Otherwise the starting rating is 3 and the AI rating replaces it (needs `OPENROUTER_API_KEY`).
- There are no tickets, statuses, resolving, CAPA or assignment. All feedback is read by HR only (Admin and Super Admin). One submission is one row; the AI's separate issues stay on that row.

## AI Voice Guide (new joiner and relieving)

Language is chosen first (English or Tamil). The guide then runs the same conversation as the general voice guide: AI intro, then for each question it reads the question aloud, gives think time, listens until the employee pauses (Sarvam speech-to-text), and moves on. Question audio is generated with Sarvam text-to-speech (`GET /api/tts/question/:type/:id?lang=` and `/api/tts/intro/:type`), cached in memory. If the audio cannot play, the browser voice is the fallback. "Type instead" switches to a typed form.

## Editing the questions (admin: Questions tab)

Admin > Questions has three tabs. **New joiner** and **Relieving** let HR edit every question in English and Tamil, mark it required or urgent, add, delete and reorder questions, and write the welcome message in each language. Edits are stored in MongoDB (`QuestionnaireConfig`) and replace the built-in questions for the form, the voice guide, the generated audio and answer validation; **Reset** returns to the built-in questions. Audio is generated from the text, so there is nothing to upload. The **General** tab is the original Tamil voice guide with uploaded audio. Endpoints: `GET/PUT /api/admin/questionnaires/:type` and `POST .../reset` (needs the settings capability).

## API changes from PFS

- Removed `POST /api/patient/lookup` and the EMR lookup. No `EMR_*` settings remain.
- `POST /api/feedback`: `patientName/patientRegNo/patientEncounterType/visitOrAdmissionDate` became `employeeName/employeeId/feedbackType/dateOfJoining`, plus `lastWorkingDay` and `answers`. `employeeId`, `employeeName` and `department` are required.
- `GET /api/feedback` and the insights queries accept `feedbackType`.
- `source` values are `employee | staff | ai`.

## Deploy

`docker-compose.yml` project `mapims_efs`, host ports 1008 / 2008 / 3008, nginx file `nginx/efs.mapims.edu.in.conf`. Confirm the slot and domain with the VPS owner before first `up`.

## Open content items

- Starter departments and services in `backend/src/hospital.js` are generic; edit on the admin screens.
- The Tamil wording of the interface and the generated Tamil intro text should be reviewed by a Tamil speaker.
- The general-feedback Voice Guide has no recorded audio yet; upload per question on the Bot Conversation admin screen.
- `SARVAM_TTS_MODEL` (default `bulbul:v3`) and `SARVAM_TTS_SPEAKER` can be set in `backend/.env`.
