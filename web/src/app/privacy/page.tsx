import type { Metadata } from "next";
import { LegalPage } from "../legal/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Celiador handles your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="Preview">
      <p>
        Celiador is built privacy-first, and we state our data practices plainly — no two-mode
        toggle where the honest default is the one you have to find and turn on. This page
        summarizes how we handle your information; the full policy will be published before general
        availability.
      </p>

      <h2>We never train on your code</h2>
      <p>
        Unconditionally. There is no setting that changes this and no tier where it flips. We do not
        use your source code, prompts, or editor actions to train models — ours or anyone&rsquo;s.
      </p>

      <h2>Your code stays local</h2>
      <p>
        Celiador runs the coding agent on your own machine against your local workspace. Your
        repository is not uploaded, and we do not build or store a server-side index or embeddings
        of your codebase. Only the specific context an agent request needs is sent for that request.
      </p>

      <h2>How AI requests work</h2>
      <p>
        You never hold a model key, and your editor never talks to the model provider directly.
        Requests are proxied through the Celiador daemon, which holds a shared key and forwards your
        messages to the AI provider for that single request. We don&rsquo;t retain those requests to
        train on them. When you run an agent in the cloud instead of locally, it executes in an
        isolated per-run workspace that is reclaimed after the run.
      </p>

      <h2>What we store</h2>
      <p>
        <strong>Account:</strong> the minimum to run your account — an identifier and email, used to
        authenticate you and to send only the product updates you opt into.
      </p>
      <p>
        <strong>Chat history:</strong> so your conversations are available across your devices, we
        store your agent chat history on our server, tied to your account. You can delete individual
        chats, or delete your whole account to remove everything.
      </p>
      <p>
        <strong>Usage:</strong> we meter per-account agent usage against your plan&rsquo;s limits.
        Those numbers are shown back to you, in full, inside the app — the same figures we enforce.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Deleting your account is self-service and permanent. It removes your account, profile, stored
        chat history, push registrations, and any cloud-run workspaces — not just a flag that hides
        them.
      </p>

      <h2>Bring your own key</h2>
      <p>
        If you use your own model-provider key, those requests go directly to that provider under
        their terms, outside our proxy.
      </p>
    </LegalPage>
  );
}
