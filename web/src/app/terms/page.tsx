import type { Metadata } from "next";
import { LegalPage } from "../legal/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Celiador.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="Preview">
      <p>
        These terms govern your use of Celiador during the preview. By using the app you agree to
        them; the final terms will be published before general availability.
      </p>
      <h2>Preview software</h2>
      <p>
        Celiador is pre-release. It may change, break, or be unavailable, and it&apos;s provided
        &quot;as is&quot; without warranties during the preview period.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use Celiador to break the law, infringe others&apos; rights, or abuse the service
        or the model providers behind it.
      </p>
      <h2>Your content</h2>
      <p>
        You keep all rights to your code and content. You grant us only the permissions needed to
        operate the product for you.
      </p>
    </LegalPage>
  );
}
