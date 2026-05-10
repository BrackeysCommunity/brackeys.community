export type SendEmailJob = {
  to: string;
  template: string;
  data: Record<string, unknown>;
};

export async function handleSendEmail(job: { data: SendEmailJob }): Promise<void> {
  // PR1: stub. Phase 10 will wire this to the existing email transport
  // (Better Auth's mailer) and render the appropriate template.
  console.log("[send_email] stub", {
    to: job.data.to,
    template: job.data.template,
  });
}
