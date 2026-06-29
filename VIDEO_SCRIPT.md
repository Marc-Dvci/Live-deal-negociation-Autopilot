# 60-Second Demo Video Script

## One-Click Flow

Open the local URL printed by `npm.cmd start`, begin screen recording, then click **Start autoplay** once. The demo runs automatically with a clean UI and one mixed audio track: `assets/demo-audio.mp3`.

Current mode: static client portrait. If the AI video is ready later, save it as `assets/client-call.mp4`; the app will use it automatically.

## Mixed Audio Track

The app plays one mixed MP3 to avoid browser timing issues from many separate clips.

- 0.35s: `Voiceover 1 - This is Real-Time.mp3`
- 6.35s: `Voiceover 2 - The seller clicks.mp3`
- 15.00s: `Client 1.mp3`
- 19.65s: `Client 2.mp3`
- 27.20s: `Seller 1 v2 - before discounting.mp3`
- 36.80s: `Voiceover 6 v2 - now compare.mp3`
- 42.00s: `Client 3.mp3`
- 47.90s: `Seller 2 v2 - we can reduce .mp3`
- 53.60s: `Voiceover 8 v2 - margin preserved.mp3`, natural speed

Final mixed duration: about 59.56 seconds.

## Recording Timeline

0-12s: Deal room opens and input docs flash: CRM, pricing policy, security signal, redline.

15-25s: Client raises the 18% discount request and legal redline.

25-31s: Cerebras/Gemma returns the private next move before the seller has to answer.

27-35s: Seller follows the AI recommendation and reframes price as rollout risk.

36-42s: Speed proof: Cerebras is ready while the 50-token-per-second baseline is too late.

42-47s: Client reveals the real blocker: Salesforce integration risk before Q3.

47-53s: Gemma catches the renewal uplift redline and the seller counters with safer clause language.

53-60s: Final impact: margin preserved, legal risk blocked, close probability up.

## Optional Client Video Prompt

Use a fictional enterprise procurement executive, calm but pressured, in a webcam-style office shot. Generate one 15-second video and save it as `assets/client-call.mp4`.

Exact client speech:

```text
We like the platform, but procurement is asking for 18% off. Legal also changed the renewal uplift clause. They said it was standard. Honestly, security is worried the Salesforce integration will miss our Q3 rollout. If you reduce rollout risk and help cash flow, I think we can sign.
```

Video prompt:

```text
Create a realistic 15-second webcam video of a fictional enterprise procurement executive on a negotiation call. The person is a middle-aged VP of Procurement in a modern office conference room, professional, calm, slightly pressured, looking into a laptop webcam. No logos, no brand names, no on-screen text, no subtitles, no watermark.

Performance direction:
- 0.0-4.3s: composed, leans slightly forward, concerned but not hostile.
- 4.3-8.0s: glances briefly down at notes, then back to camera when mentioning legal.
- 8.0-12.2s: expression tightens when mentioning security and Q3 rollout.
- 12.2-15.0s: softens and nods once, signaling the deal can close if risk and cash flow are solved.

Style: realistic corporate video call, head-and-shoulders framing, subtle webcam compression, natural office lighting, steady camera, neutral background, no extra people.
```

## X/Twitter Post Draft

We built Real-Time Deal Room for the @Cerebras + @googlegemma hackathon: a live negotiation autopilot that tells a seller what to say before the next sentence is spoken.

At 50 tok/s the AI is still drafting. At Cerebras speed, the seller protects margin, catches legal risk, and keeps the deal moving.
