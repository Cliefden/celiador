# Ask: Claude plan sign-in for Celiador (draft, not sent)

Decision 2026-10-22: Claude drafts, Stefan decides later whether and when to send. The plan's Bet 2 ("the best place to spend a Claude plan you already pay for") needs Anthropic's explicit approval; third-party apps may not offer Claude.ai sign-in without it.

**To:** Anthropic developer partnerships (via the Claude Developer Platform contact form or the partnerships address listed on anthropic.com at the time of sending)
**From:** stefan@celiador.ai
**Subject:** Celiador: request to let Claude Pro/Max subscribers sign in to a third-party editor

---

Hello,

I build Celiador (https://celiador.ai), an open-source fork of VS Code with a companion iOS app. It is Claude-native by construction: the only agent is Claude, run through the Claude Agent SDK, and a small open-source server of ours holds the API key so client apps never see a credential. Developers label a GitHub issue, an agent runs it in its own git worktree on their machine, and they review and merge the pull request from their phone.

Today every Celiador user runs on our API key, metered per user with published limits. Many of the developers we talk to already pay for Claude Pro or Max and would rather use that plan than a second subscription. We would like to let them sign in to Celiador with their Claude account and have their Celiador usage count against their own plan, the way Claude Code does.

Specifically, we are asking whether Anthropic would:

1. permit a third-party application to use Claude.ai OAuth sign-in (the `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` path, or an equivalent you prefer) so a subscriber's requests are billed to their plan;
2. tell us the terms that come with it: attribution, rate limits, what we may and may not build on top (we do not train on or retain code; our data policy is published at https://celiador.ai/privacy);
3. tell us whether there is a partner or marketplace program this should go through instead.

What we can offer: Celiador is open source (Apache-2.0), the agent host and the server are inspectable, and we publish the limits we enforce. We are a small team with [N] weekly active developers as of [date]; the current rate of agent pull requests merged per user is [X] per week. We would be glad to share usage data, run a pilot, or adopt any sign-in flow you specify.

If this is not something Anthropic offers to third parties, a short no is just as useful: we will build bring-your-own-key and hosted billing instead.

Thank you,
Stefan Crafoord-Wiklund
Celiador, https://celiador.ai

---

Fill in before sending: the recipient, [N] and [date] from TelemetryDeck / `GET /api/me`, and [X] from the merged-PR count once outside users exist. Keep it under one screen.
