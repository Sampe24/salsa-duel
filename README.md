# Salsa Duel 💃🕺

A webcam-based dance battle game (Just Dance style) — dance salsa moves in front of your camera and get scored in real time. Play solo or challenge a friend online.

## Features
- **Full-body tracking** in the browser (MediaPipe Pose — arms, hands, legs, feet). No install, camera only.
- **Two characters**: Yossi and Samuel.
- **3 AI-generated salsa/latino tracks** (Google Lyria RealTime), each with beat-synced choreography.
- **Online multiplayer**: create a room, share the 4-letter code, dance head-to-head with live scores (Supabase Realtime).
- **Custom songs**: load any MP3 from your disk — the beat is detected automatically (with a tap-tempo fallback) and choreography is generated. In multiplayer only the host needs the file: it transfers peer-to-peer over WebRTC (never uploaded to a server), with a Realtime relay fallback for strict networks.
- Scoring: Perfect / ¡Bien! / OK / Miss with combo multipliers.

## Play
Open the game over HTTPS (webcam requires it), allow camera access, and step back ~2–3 m so your whole body is visible.

Local dev: `npx serve .` then open http://localhost:3000.

## Regenerating music
`node tools/generate_music.mjs` (needs `GEMINI_API_KEY` in `.env`, ffmpeg on PATH).

## Tech
Plain HTML/CSS/JS · MediaPipe Tasks Vision · Supabase Realtime · WebAudio
