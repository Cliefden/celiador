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
        Celiador is built privacy-first. This page summarizes how we handle your information; the
        full policy will be published before general availability.
      </p>
      <h2>Your code</h2>
      <p>
        We do not use your source code to train models. Code you open in the editor stays on your
        machine unless you explicitly send it to an AI provider for a request.
      </p>
      <h2>Account data</h2>
      <p>
        When you sign in, we store the minimum needed to run your account — an identifier and email.
        We use this to authenticate you and send product updates you opt into.
      </p>
      <h2>Model providers</h2>
      <p>
        If you bring your own key, requests go directly to that provider under their terms. If you
        use our hosted models, requests are proxied through our backend and not retained for
        training.
      </p>
    </LegalPage>
  );
}
