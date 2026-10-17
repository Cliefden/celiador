Celiador for iPhone — companion to the Celiador editor on your Mac.

What's in this build
- Watch an agent run from your editor live, and steer it: send follow-ups, approve or deny a tool call, answer the agent's questions, cancel.
- Start a run on a repo your editor already has open ("From your editor"), or in the cloud.
- Explorer: browse and edit files of a running session.
- Changes: review the run's diff, discard files, commit, push and open a pull request.
- Account: today's usage against the daemon's quota.

Please try
1. Sign in (magic link), then confirm your Mac's open repos appear under "From your editor".
2. Start a run from the phone, type a first message, and check both your question and the answer show in the transcript.
3. Type a follow-up in the editor and confirm it appears on the phone; then the reverse.
4. Approve or deny a tool call from the phone; answer one agent question.
5. Let the run finish: it must reach a final state (no permanent "running").
6. Open a file in Explorer, edit, save; check the editor sees the change.
7. In Changes, discard one file, commit the rest, open a PR.

Known gaps
- Cloud runs of private repositories are not supported yet (run on your editor instead).
- Widgets and the Live Activity need a push; if none arrives, check notification permission.

Send feedback through TestFlight (screenshot + shake) or to stefan@celiador.ai.
